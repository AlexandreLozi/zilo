// ZiloClient: detection, auth, devices and caps, and the SDK side of the lost-session contract
// (CONTRACT.md §3, §4, §12).
import { AuthClient } from './auth.js';
import {
  MemoryCredentialStore,
  type CredentialStore,
  type FamilyCredential,
} from './credentials.js';
import { decodeCaps, decodeDeviceList, decodeHello, decodeJob } from './decode.js';
import {
  Detector,
  type DetectionListener,
  type DetectionSnapshot,
  type ProbeResult,
} from './detection.js';
import {
  isProblem,
  ZiloAccessRevokedError,
  ZiloAgentRestartedError,
  ZiloError,
  ZiloProtocolError,
  ZiloTransportError,
} from './errors.js';
import { createLogger, type DebugLogger } from './log.js';
import type { PermissionsLike } from './permission.js';
import { HttpTransport, type FetchLike, type HttpResponse } from './transport.js';
import type { CreateJobRequest, DeviceCaps, DeviceList, HelloFull, Job } from './types.js';

/**
 * Placeholder agent ports: the fixed port and its two fallbacks (R-T1). T11 sets the real numbers;
 * the OpenAPI server variable only gives `48100` as a placeholder default.
 */
export const DEFAULT_PORTS: readonly number[] = [48100, 48101, 48102];

/** Per-port `hello` probe timeout. All ports are probed in parallel, so the verdict takes at most this long. */
export const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

export interface ZiloClientOptions {
  ports?: readonly number[] | undefined;
  /** The page origin. Defaults to `location.origin`. */
  origin?: string | undefined;
  fetch?: FetchLike | undefined;
  permissions?: PermissionsLike | undefined;
  store?: CredentialStore | undefined;
  logger?: DebugLogger | undefined;
  requestTimeoutMs?: number | undefined;
  probeTimeoutMs?: number | undefined;
  /** The site's minimum agent version; below it, detection ends in `outdated-authorized`. */
  minAgentVersion?: string | undefined;
  /** Defaults to a user-agent check. */
  isSafari?: boolean | undefined;
  now?: (() => number) | undefined;
  recheckIntervalMs?: number | undefined;
  recheckCapMs?: number | undefined;
}

/** A job this SDK instance created and tracks, with its family and agent instance (R-A15, R-R3). */
export interface TrackedJob {
  readonly id: string;
  readonly familyId: string;
  readonly instanceId: string;
  /** Set when the SDK classified the job as lost (SDK-local, R-R3). */
  outcome?: 'agent-restarted';
}

export type JobsLostListener = (jobs: readonly TrackedJob[]) => void;

/**
 * A tracked job is gone for this caller (R-A10 step 3): its family's credential is gone and the
 * agent instance is unchanged. UI copy: `not-found`.
 */
export class ZiloJobLostError extends ZiloError {
  override name = 'ZiloJobLostError';
  readonly code = 'not-found';
  readonly jobId: string;
  constructor(jobId: string) {
    super(`job ${jobId} is no longer reachable`);
    this.jobId = jobId;
  }
}

export function detectSafari(userAgent: string | undefined): boolean {
  if (userAgent === undefined) return false;
  return (
    /Safari\//.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg|OPR|Firefox)\//.test(userAgent)
  );
}

interface CallOptions {
  op: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** The request is about this tracked job: use its family's credential (R-A15). */
  job?: TrackedJob | undefined;
  newScan?: boolean;
}

export class ZiloClient {
  readonly detection: Detector;
  readonly auth: AuthClient;
  private readonly ports: readonly number[];
  private readonly origin: string;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly requestTimeoutMs: number | undefined;
  private readonly probeTimeoutMs: number;
  private readonly logger: DebugLogger | undefined;
  private readonly log: DebugLogger;
  private transport: HttpTransport | undefined;
  private readonly jobs = new Map<string, TrackedJob>();
  /** `instanceId` read with each family's credential (R-R3 recording). */
  private readonly familyInstance = new Map<string, string>();
  private readonly lostListeners = new Set<JobsLostListener>();

  constructor(options: ZiloClientOptions = {}) {
    const g = globalThis as { location?: { origin?: string }; navigator?: { userAgent?: string } };
    this.ports = options.ports ?? DEFAULT_PORTS;
    this.origin = options.origin ?? g.location?.origin ?? '';
    this.fetchImpl = options.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.logger = options.logger;
    this.log = createLogger(options.logger);
    const now = options.now ?? (() => Date.now());
    this.auth = new AuthClient({
      origin: this.origin,
      store: options.store ?? new MemoryCredentialStore(),
      transport: () => this.agent(),
      now,
      familiesWithJobs: () =>
        new Set(
          [...this.jobs.values()].filter((j) => j.outcome === undefined).map((j) => j.familyId),
        ),
    });
    this.detection = new Detector({
      origin: this.origin,
      isSafari: options.isSafari ?? detectSafari(g.navigator?.userAgent),
      permissions: options.permissions,
      probe: (signal) => this.probe(signal),
      hasToken: () => this.auth.hasUsableCurrent(),
      requestConsent: (signal) => this.auth.requestConsent(signal),
      readConsent: (signal) => this.auth.readConsent(signal),
      authorize: (signal) => this.authorize(signal),
      minAgentVersion: options.minAgentVersion,
      recheckIntervalMs: options.recheckIntervalMs,
      recheckCapMs: options.recheckCapMs,
    });
  }

  /** Starts detection; call it from a user gesture (D-008, R-A1). */
  connect(): Promise<DetectionSnapshot> {
    return this.detection.start();
  }

  onState(listener: DetectionListener): () => void {
    return this.detection.subscribe(listener);
  }

  /** Called with the jobs the SDK classified as `agent-restarted` (R-R3). Never triggers a rescan. */
  onJobsLost(listener: JobsLostListener): () => void {
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  get trackedJobs(): readonly TrackedJob[] {
    return [...this.jobs.values()];
  }

  private agent(): HttpTransport {
    if (this.transport === undefined)
      throw new ZiloTransportError('not connected: no agent was detected');
    return this.transport;
  }

  private makeTransport(port: number): HttpTransport {
    return new HttpTransport(port, {
      fetch: this.fetchImpl,
      timeoutMs: this.requestTimeoutMs,
      logger: this.logger,
    });
  }

  /** Probes `hello` on every port in parallel; the first Zilo answer wins (R-T1). */
  private async probe(signal: AbortSignal): Promise<ProbeResult | undefined> {
    const started = Date.now();
    const inner = new AbortController();
    const onAbort = (): void => {
      inner.abort();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const found = await Promise.any(
        this.ports.map(async (port) => {
          const t = this.makeTransport(port);
          const res = await t.request({
            op: 'getHello',
            method: 'GET',
            path: '/zilo/v1/hello',
            signal: inner.signal,
            timeoutMs: this.probeTimeoutMs,
          });
          const hello = decodeHello(res.body);
          if (hello === undefined) throw new ZiloProtocolError('foreign service');
          return { port, hello, transport: t };
        }),
      );
      this.transport = found.transport;
      this.log('probe.found', { port: found.port, ms: Date.now() - started });
      return { port: found.port, hello: found.hello };
    } catch {
      this.log('probe.none', { ports: this.ports.length, ms: Date.now() - started });
      return undefined;
    } finally {
      inner.abort();
      signal.removeEventListener('abort', onAbort);
    }
  }

  private async authorize(signal: AbortSignal): Promise<HelloFull> {
    const cred = await this.auth.currentCredential({ signal });
    return this.readFullHello(cred, signal);
  }

  /** Reads the full `hello` with a family's credential and runs the instance comparison (R-R3). */
  private async readFullHello(cred: FamilyCredential, signal?: AbortSignal): Promise<HelloFull> {
    let current = cred;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.agent().request({
        op: 'getHello',
        method: 'GET',
        path: '/zilo/v1/hello',
        token: current.token,
        signal,
      });
      const hello = decodeHello(res.body);
      if (hello === undefined) throw new ZiloProtocolError('foreign service');
      if (hello.scope === 'full') {
        this.familyInstance.set(current.familyId, hello.instanceId);
        await this.observeInstance(hello.instanceId, current.familyId);
        return hello;
      }
      // An invalid token on hello falls back to public (R-V2): treat it as token-invalid (R-A10).
      const other = await this.auth.recoverInvalid(current.familyId, current.token);
      current = other ?? (await this.auth.currentCredential({ signal }));
    }
    throw new ZiloProtocolError('hello stayed public with a fresh token');
  }

  /**
   * R-R3: every tracked job recorded under another instance is `agent-restarted`; the families
   * held before ended with the old process, so their entries are dropped (except `keep`, the
   * family that just read the new instance).
   */
  private async observeInstance(instanceId: string, keep: string): Promise<void> {
    const lost: TrackedJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.outcome === undefined && job.instanceId !== instanceId) {
        job.outcome = 'agent-restarted';
        lost.push(job);
      }
    }
    const stale = [...this.familyInstance]
      .filter(([, id]) => id !== instanceId)
      .map(([family]) => family);
    if (lost.length === 0 && stale.length === 0) return;
    for (const f of stale) this.familyInstance.delete(f);
    await this.auth.dropAllExcept(keep);
    this.log('instance.changed', { lostJobs: lost.length, droppedFamilies: stale.length });
    if (lost.length > 0) for (const l of this.lostListeners) l(lost);
  }

  /** Recovery-path instance check (R-R3): re-acquires a credential and reads the full `hello`. */
  private async checkInstance(signal?: AbortSignal): Promise<void> {
    const cred = await this.auth.currentCredential({ signal });
    await this.readFullHello(cred, signal);
  }

  private async jobGone(
    job: TrackedJob,
    signal: AbortSignal | undefined,
    cause: unknown,
  ): Promise<never> {
    try {
      await this.checkInstance(signal);
    } catch {
      // The check itself failed; report what we know.
    }
    if (job.outcome === 'agent-restarted') throw new ZiloAgentRestartedError(job.id);
    this.jobs.delete(job.id);
    if (isProblem(cause, 'not-found')) throw cause;
    throw new ZiloJobLostError(job.id);
  }

  /** An authenticated call with the R-A10 / R-A13 / R-R3 recovery paths. */
  private async call(o: CallOptions): Promise<{ res: HttpResponse; cred: FamilyCredential }> {
    const { job, signal } = o;
    if (job?.outcome === 'agent-restarted') throw new ZiloAgentRestartedError(job.id);
    let cred = job
      ? await this.auth.freshCredential(job.familyId, signal)
      : await this.auth.currentCredential({ newScan: o.newScan === true, signal });
    if (cred === undefined) return this.jobGone(job as TrackedJob, signal, undefined);
    const send = (c: FamilyCredential): Promise<HttpResponse> =>
      this.agent().request({
        op: o.op,
        method: o.method,
        path: o.path,
        body: o.body,
        token: c.token,
        signal,
      });

    for (let attempt = 0; ; attempt++) {
      try {
        return { res: await send(cred), cred };
      } catch (err) {
        if (isProblem(err, 'token-invalid') && attempt === 0) {
          const other = await this.auth.recoverInvalid(cred.familyId, cred.token);
          if (other !== undefined) {
            cred = other;
            continue;
          }
          if (job !== undefined) return this.jobGone(job, signal, err);
          cred = await this.auth.currentCredential({ newScan: o.newScan === true, signal });
          await this.readFullHello(cred, signal);
          continue;
        }
        if (isProblem(err, 'token-revoked')) {
          await this.auth.dropFamily(cred.familyId);
          this.detection.markRevoked();
          throw new ZiloAccessRevokedError('access revoked', { cause: err });
        }
        if (isProblem(err, 'not-found') && job !== undefined) return this.jobGone(job, signal, err);
        if (err instanceof ZiloTransportError) await this.afterTransportFailure(job, signal, err);
        throw err;
      }
    }
  }

  /** R-A13 and the R-R3 transport recovery path. Throws the classified error, or returns. */
  private async afterTransportFailure(
    job: TrackedJob | undefined,
    signal: AbortSignal | undefined,
    cause: ZiloTransportError,
  ): Promise<void> {
    let helloAnswered: boolean;
    try {
      const res = await this.agent().request({
        op: 'getHello',
        method: 'GET',
        path: '/zilo/v1/hello',
        signal,
        timeoutMs: this.probeTimeoutMs,
      });
      helloAnswered = decodeHello(res.body) !== undefined;
    } catch {
      helloAnswered = false;
    }
    if (!helloAnswered) {
      this.detection.markUnreachable();
      return;
    }
    const consent = await this.auth.readConsent(signal).catch(() => undefined);
    if (consent !== undefined && ['none', 'denied', 'blocked'].includes(consent.state)) {
      await this.auth.dropAllExcept(undefined);
      this.detection.markRevoked();
      throw new ZiloAccessRevokedError('access revoked', { cause });
    }
    try {
      await this.checkInstance(signal);
    } catch {
      return;
    }
    if (job?.outcome === 'agent-restarted') throw new ZiloAgentRestartedError(job.id);
  }

  /** The full `hello` with the current family (re-checks the instance, R-R3). */
  async hello(signal?: AbortSignal): Promise<HelloFull> {
    return this.readFullHello(await this.auth.currentCredential({ signal }), signal);
  }

  /** `GET /devices`: the cached list; never starts discovery (R-D1). */
  async listDevices(signal?: AbortSignal): Promise<DeviceList> {
    const { res } = await this.call({
      op: 'listDevices',
      method: 'GET',
      path: '/zilo/v1/devices',
      signal,
    });
    return decodeDeviceList(res.body);
  }

  /** `POST /devices/refresh`: runs discovery now and returns the list after it (R-D1). */
  async refreshDevices(signal?: AbortSignal): Promise<DeviceList> {
    const { res } = await this.call({
      op: 'refreshDevices',
      method: 'POST',
      path: '/zilo/v1/devices/refresh',
      signal,
    });
    return decodeDeviceList(res.body);
  }

  /** `GET /devices/{id}/caps`. Unknown fields and enum values survive; see `resolutionChoice` (R-D4). */
  async getCaps(deviceId: string, signal?: AbortSignal): Promise<DeviceCaps> {
    const path = `/zilo/v1/devices/${encodeURIComponent(deviceId)}/caps`;
    const { res } = await this.call({ op: 'getDeviceCaps', method: 'GET', path, signal });
    return decodeCaps(res.body);
  }

  /**
   * `POST /jobs`. Before the first job of a family, reads the full `hello` with that family's
   * credential to record the `instanceId` (R-R3). The job is tracked with its family.
   */
  async createJob(request: CreateJobRequest, signal?: AbortSignal): Promise<Job> {
    const cred = await this.auth.currentCredential({ newScan: true, signal });
    if (!this.familyInstance.has(cred.familyId)) await this.readFullHello(cred, signal);
    const { res, cred: used } = await this.call({
      op: 'createJob',
      method: 'POST',
      path: '/zilo/v1/jobs',
      body: request,
      signal,
      newScan: true,
    });
    if (!this.familyInstance.has(used.familyId)) await this.readFullHello(used, signal);
    const job = decodeJob(res.body);
    const instanceId = this.familyInstance.get(used.familyId);
    if (instanceId === undefined)
      throw new ZiloProtocolError('no instanceId recorded for the job family');
    this.jobs.set(job.id, { id: job.id, familyId: used.familyId, instanceId });
    return job;
  }

  private jobPath(id: string): string {
    return `/zilo/v1/jobs/${encodeURIComponent(id)}`;
  }

  /**
   * `GET /jobs/{id}`. A tracked job uses its family's credential; an `agent-restarted` job throws
   * `ZiloAgentRestartedError` without a request. An unknown job gets the typed `404 not-found`.
   */
  async getJob(id: string, signal?: AbortSignal): Promise<Job> {
    const { res } = await this.call({
      op: 'getJob',
      method: 'GET',
      path: this.jobPath(id),
      signal,
      job: this.jobs.get(id),
    });
    return decodeJob(res.body);
  }

  /** `DELETE /jobs/{id}` (dispose), then stops tracking the job. */
  async disposeJob(id: string, signal?: AbortSignal): Promise<void> {
    const job = this.jobs.get(id);
    if (job?.outcome === 'agent-restarted') {
      this.jobs.delete(id);
      return;
    }
    await this.call({ op: 'disposeJob', method: 'DELETE', path: this.jobPath(id), signal, job });
    this.jobs.delete(id);
  }

  /** Forgets a job locally (for example after the app has shown the `agent-restarted` outcome). */
  forgetJob(id: string): void {
    this.jobs.delete(id);
  }

  /** `DELETE /auth/token`: revokes the current family (R-A12). */
  async disconnect(signal?: AbortSignal): Promise<void> {
    await this.auth.revokeCurrent(signal);
  }
}
