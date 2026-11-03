// ZiloClient: detection, auth, devices and caps, and the SDK side of the lost-session contract
// (CONTRACT.md §3, §4, §12).
import { throwIfAborted } from './abort.js';
import { AuthClient } from './auth.js';
import {
  MemoryCredentialStore,
  type CredentialStore,
  type FamilyCredential,
} from './credentials.js';
import {
  decodeCaps,
  decodeDeviceList,
  decodeHello,
  decodeJob,
  decodeJobList,
} from './decode.js';
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
  ZiloDisposedError,
  ZiloError,
  ZiloProtocolError,
  ZiloTransportError,
} from './errors.js';
import {
  DEFAULT_SSE_HEARTBEAT_SECONDS,
  heartbeatTimeoutFor,
  JobEventStream,
  type BackoffOptions,
  type JobSettledSnapshot,
} from './events.js';
import { createLogger, type DebugLogger } from './log.js';
import type { PermissionsLike } from './permission.js';
import { HttpTransport, type FetchLike, type HttpResponse } from './transport.js';
import type {
  CreateJobRequest,
  DeviceCaps,
  DeviceList,
  HelloFull,
  Job,
  Limits,
} from './types.js';

/**
 * **Placeholder** agent ports: the fixed port and its two fallbacks (R-T1). They stay a
 * placeholder until T11 publishes the shared port tuple, which then replaces these numbers (no
 * divergent SDK and agent constants); the OpenAPI server variable only gives `48100` as a default.
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

/** A job this SDK instance tracks, with its family and agent instance (R-A15, R-R3). */
export interface TrackedJob {
  readonly id: string;
  readonly familyId: string;
  /**
   * The `instanceId` current when the job was created, or `undefined` for a job discovered
   * through `GET /jobs` before its family's full `hello` was read (R-R3).
   */
  readonly instanceId: string | undefined;
  /** Set when the SDK classified the job as lost (SDK-local, R-R3). */
  outcome?: 'agent-restarted';
}

/** Options of `cancelJob` (§5.3, R-J2). */
export interface CancelOptions {
  signal?: AbortSignal | undefined;
  /** Dispose the job once it is cancelled (§5.3); ignored on a settled job. */
  discardPages?: boolean | undefined;
}

export interface CancelResult {
  job: Job;
  /** `202` when the cancellation was accepted; `200` when the job was already settled. */
  accepted: boolean;
}

/** Options of `streamEvents` (§6). */
export interface EventStreamOptions {
  signal?: AbortSignal | undefined;
  /** Last `seq` already processed, to resume (R-E5). */
  lastEventId?: number | undefined;
  backoff?: BackoffOptions | undefined;
  /** Overrides the 3× `limits.sseHeartbeatSeconds` dead-stream bound (R-E6). */
  heartbeatTimeoutMs?: number | undefined;
  /** Reconnects before the stream fails. */
  maxReconnects?: number | undefined;
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

interface RecoveryOptions {
  signal?: AbortSignal | undefined;
  /** The request is about this tracked job: use its family's credential (R-A15). */
  job?: TrackedJob | undefined;
  /** A new scan: the rollover rule may start a new family, once per request (R-A15). */
  newScan?: boolean;
  /** Read the full `hello` with the family before its first use (R-R3 recording). */
  recordInstance?: boolean;
  /** `use` itself reads the full `hello`, so recovery does not read it a second time. */
  readsHello?: boolean;
}

interface CallOptions extends RecoveryOptions {
  op: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
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
  /** Full `hello.limits` of the agent, once a full `hello` was read (§10, R-E6). */
  private limits: Limits | undefined;
  /** Open event streams, aborted by `dispose()` (§6, R-A16). */
  private readonly streams = new Set<JobEventStream>();
  private readonly lostListeners = new Set<JobsLostListener>();
  /** Aborted by `dispose()`: every request of this instance, in flight or later, aborts. */
  private readonly life = new AbortController();

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
      closed: () => this.life.signal.aborted,
    });
    this.detection = new Detector({
      origin: this.origin,
      isSafari: options.isSafari ?? detectSafari(g.navigator?.userAgent),
      permissions: options.permissions,
      probe: (signal) => this.probe(signal),
      hasToken: (signal) => this.auth.hasUsableCurrent(signal),
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
    if (this.disposed) return Promise.reject(new ZiloDisposedError());
    return this.detection.start();
  }

  onState(listener: DetectionListener): () => void {
    return this.detection.subscribe(listener);
  }

  /** Called with the jobs the SDK classified as `agent-restarted` (R-R3). Never triggers a rescan. */
  onJobsLost(listener: JobsLostListener): () => void {
    if (this.disposed) return () => false;
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  /** True once `dispose()` ran. */
  get disposed(): boolean {
    return this.life.signal.aborted;
  }

  /**
   * Full teardown, for the host app's Unload (every dialog close): cancels detection, its re-check
   * and consent polling, aborts every in-flight request, drops every subscriber and the local job
   * registry, and makes every later call fail with `ZiloDisposedError`. A grant that arrives later
   * never makes this instance issue a token. Idempotent and synchronous.
   *
   * It does not revoke: the stored credentials belong to the `CredentialStore`, so a new instance
   * over the same store (the next Load) reuses the family without a new issuance. Call
   * `disconnect()` first to revoke.
   */
  dispose(): void {
    if (this.disposed) return;
    this.life.abort();
    for (const stream of [...this.streams]) stream.abort();
    this.streams.clear();
    this.detection.dispose();
    this.lostListeners.clear();
    this.jobs.clear();
    this.familyInstance.clear();
    this.transport = undefined;
    this.log('client.disposed', {});
  }

  get trackedJobs(): readonly TrackedJob[] {
    return [...this.jobs.values()];
  }

  private agent(): HttpTransport {
    if (this.disposed) throw new ZiloDisposedError();
    if (this.transport === undefined)
      throw new ZiloTransportError('not connected: no agent was detected');
    return this.transport;
  }

  private makeTransport(port: number): HttpTransport {
    return new HttpTransport(port, {
      fetch: this.fetchImpl,
      timeoutMs: this.requestTimeoutMs,
      logger: this.logger,
      lifetime: this.life.signal,
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
      if (this.disposed) throw new ZiloDisposedError();
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

  /**
   * Detection's authorisation: the current family's credential and the full `hello`, through the
   * same recovery as every protected call (a renewal `401` after an agent restart recovers).
   */
  private async authorize(signal: AbortSignal): Promise<HelloFull> {
    const { value } = await this.withRecovery({ signal, readsHello: true }, async (c) => {
      const { hello, cred } = await this.readFullHello(c, signal);
      return { value: hello, cred };
    });
    return value;
  }

  /**
   * Reads the full `hello` with a family's credential and runs the instance comparison (R-R3).
   * Returns the credential that read it: a different one when the first was no longer valid.
   */
  private async readFullHello(
    cred: FamilyCredential,
    signal?: AbortSignal,
  ): Promise<{ hello: HelloFull; cred: FamilyCredential }> {
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
        this.limits = hello.limits;
        await this.observeInstance(hello.instanceId, current.familyId, signal);
        return { hello, cred: current };
      }
      // An invalid token on hello falls back to public (R-V2): treat it as token-invalid (R-A10).
      const other = await this.auth.recoverInvalid(current.familyId, current.token, signal);
      current = other ?? (await this.auth.currentCredential({ signal }));
    }
    throw new ZiloProtocolError('hello stayed public with a fresh token');
  }

  /**
   * R-R3: every tracked job recorded under another instance is `agent-restarted`; the families
   * held before ended with the old process, so their entries are dropped (except `keep`, the
   * family that just read the new instance). The drop is a credential write and honours `signal`
   * and disposal; the stale families stay recorded until it lands, so a drop skipped by an aborted
   * run happens on the next full `hello` of a live run instead of being lost.
   */
  private async observeInstance(
    instanceId: string,
    keep: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const lost: TrackedJob[] = [];
    for (const job of this.jobs.values()) {
      if (
        job.outcome === undefined &&
        job.instanceId !== undefined &&
        job.instanceId !== instanceId
      ) {
        job.outcome = 'agent-restarted';
        lost.push(job);
      }
    }
    const stale = [...this.familyInstance]
      .filter(([, id]) => id !== instanceId)
      .map(([family]) => family);
    if (lost.length === 0 && stale.length === 0) return;
    let dropped = false;
    try {
      await this.auth.dropAllExcept(keep, signal);
      for (const f of stale) this.familyInstance.delete(f);
      dropped = true;
    } finally {
      this.log('instance.changed', {
        lostJobs: lost.length,
        droppedFamilies: dropped ? stale.length : 0,
        dropDeferred: !dropped,
      });
      if (lost.length > 0) for (const l of this.lostListeners) l(lost);
    }
  }

  /** Recovery-path instance check (R-R3): re-acquires a credential and reads the full `hello`. */
  private async checkInstance(signal?: AbortSignal): Promise<void> {
    const cred = await this.auth.currentCredential({ signal });
    await this.readFullHello(cred, signal);
  }

  private async jobGone(
    job: TrackedJob,
    signal: AbortSignal | undefined,
    cause?: unknown,
  ): Promise<never> {
    try {
      await this.checkInstance(signal);
    } catch {
      // The check itself failed; report what we know.
    }
    if (this.disposed) throw new ZiloDisposedError();
    if (job.outcome === 'agent-restarted') throw new ZiloAgentRestartedError(job.id);
    this.jobs.delete(job.id);
    if (isProblem(cause, 'not-found')) throw cause;
    throw new ZiloJobLostError(job.id);
  }

  /**
   * Runs `use` with a credential under the R-A10 / R-A12 / R-A13 / R-R3 recovery paths. Credential
   * acquisition and renewal are inside the same path as the protected request: a renewal that
   * fails with `401`, `token-revoked` or a transport error recovers exactly like the request.
   * The credential is selected once per attempt and kept through the request, so one new scan
   * applies the rollover rule once (R-A15).
   */
  private async withRecovery<T>(
    o: RecoveryOptions,
    use: (cred: FamilyCredential) => Promise<{ value: T; cred: FamilyCredential }>,
  ): Promise<{ value: T; cred: FamilyCredential }> {
    const { job, signal } = o;
    const newScan = o.newScan === true;
    if (job?.outcome === 'agent-restarted') throw new ZiloAgentRestartedError(job.id);
    let cred: FamilyCredential | undefined;
    let recovered = false;
    for (;;) {
      let used = cred;
      try {
        if (cred === undefined) {
          const acquired = job
            ? await this.auth.freshCredential(job.familyId, signal)
            : await this.auth.currentCredential({ newScan, signal });
          if (acquired === undefined) return await this.jobGone(job as TrackedJob, signal);
          cred = acquired;
        }
        if (o.recordInstance === true && !this.familyInstance.has(cred.familyId)) {
          used = cred;
          cred = (await this.readFullHello(cred, signal)).cred;
        }
        used = cred;
        return await use(cred);
      } catch (err) {
        if (err instanceof ZiloAgentRestartedError || err instanceof ZiloJobLostError) throw err;
        if (this.disposed) throw new ZiloDisposedError();
        // The caller's signal aborted (for detection: the run's deadline, cancel or replacement):
        // no recovery step, no write and no new request starts after that.
        throwIfAborted(signal);
        // A renewal failure names the credential renewal presented; otherwise the request's.
        const failed = this.auth.renewalCredential(err) ?? used;
        if (isProblem(err, 'token-invalid') && !recovered && failed !== undefined) {
          recovered = true;
          const other = await this.auth.recoverInvalid(failed.familyId, failed.token, signal);
          if (other !== undefined) {
            cred = other;
            continue;
          }
          if (job !== undefined) return await this.jobGone(job, signal, err);
          // R-A10 step 2 and R-R3: a credential for the current family (rollover rule), and the
          // full hello, which re-checks the instance.
          cred = await this.auth.currentCredential({ newScan, signal });
          if (o.readsHello !== true) cred = (await this.readFullHello(cred, signal)).cred;
          continue;
        }
        if (isProblem(err, 'token-revoked')) {
          if (failed !== undefined) await this.auth.dropFamily(failed.familyId, signal);
          this.detection.markRevoked();
          throw new ZiloAccessRevokedError('access revoked', { cause: err });
        }
        if (isProblem(err, 'not-found') && job !== undefined) {
          return await this.jobGone(job, signal, err);
        }
        if (err instanceof ZiloTransportError) await this.afterTransportFailure(job, signal, err);
        throw err;
      }
    }
  }

  /** An authenticated call with the recovery paths of `withRecovery`. */
  private async call(o: CallOptions): Promise<{ res: HttpResponse; cred: FamilyCredential }> {
    const { value, cred } = await this.withRecovery(o, async (c) => {
      const res = await this.agent().request({
        op: o.op,
        method: o.method,
        path: o.path,
        body: o.body,
        token: c.token,
        signal: o.signal,
      });
      return { value: res, cred: c };
    });
    return { res: value, cred };
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
      await this.auth.dropAllExcept(undefined, signal);
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
    const { value } = await this.withRecovery({ signal, readsHello: true }, async (c) => {
      const { hello, cred } = await this.readFullHello(c, signal);
      return { value: hello, cred };
    });
    return value;
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

  /**
   * `POST /devices/refresh`: runs discovery now and returns the `DeviceList` of that response
   * (R-D1), without a second `GET`; incomplete-driver and timeout fields are kept as sent.
   */
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
   * `POST /jobs`. Selects the new-scan credential once (rollover rule, R-A15) and keeps it through
   * the request. Before the first job of a family, reads the full `hello` with that family's
   * credential to record the `instanceId` (R-R3). The job is tracked with its family.
   */
  async createJob(request: CreateJobRequest, signal?: AbortSignal): Promise<Job> {
    const { res, cred: used } = await this.call({
      op: 'createJob',
      method: 'POST',
      path: '/zilo/v1/jobs',
      body: request,
      signal,
      newScan: true,
      recordInstance: true,
    });
    const job = decodeJob(res.body);
    const instanceId = this.familyInstance.get(used.familyId);
    if (instanceId === undefined)
      throw new ZiloProtocolError('no instanceId recorded for the job family');
    if (this.disposed) throw new ZiloDisposedError();
    this.jobs.set(job.id, { id: job.id, familyId: used.familyId, instanceId });
    return job;
  }

  /**
   * `GET /jobs`: issued once per stored family and merged (R-A15), because the agent lists only
   * the caller's family's jobs (R-J1). A family whose credential is gone is dropped silently; a
   * family that answers `token-revoked` is dropped too. Never issues a token, so it cannot prompt.
   */
  async listJobs(signal?: AbortSignal): Promise<Job[]> {
    if (this.disposed) throw new ZiloDisposedError();
    const families = await this.auth.allCredentials(signal);
    const merged = new Map<string, Job>();
    for (const family of families) {
      const jobs = await this.listFamilyJobs(family, signal);
      for (const job of jobs) {
        merged.set(job.id, job);
        this.rememberJob(job, family.familyId);
      }
    }
    return [...merged.values()];
  }

  /** One family's `GET /jobs`, with the R-A10 single retry on another stored token of that family. */
  private async listFamilyJobs(
    family: FamilyCredential,
    signal: AbortSignal | undefined,
  ): Promise<Job[]> {
    let token = family.token;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.agent().request({
          op: 'listJobs',
          method: 'GET',
          path: '/zilo/v1/jobs',
          token,
          signal,
        });
        return decodeJobList(res.body).jobs;
      } catch (err) {
        if (this.disposed) throw new ZiloDisposedError();
        throwIfAborted(signal);
        if (attempt > 0) throw err;
        if (isProblem(err, 'token-invalid')) {
          const other = await this.auth.recoverInvalid(family.familyId, token, signal);
          if (other === undefined) return [];
          token = other.token;
          continue;
        }
        if (isProblem(err, 'token-revoked')) {
          await this.auth.dropFamily(family.familyId, signal);
          return [];
        }
        throw err;
      }
    }
  }

  /** Tracks a job discovered through `GET /jobs`, with its family (R-A15). */
  private rememberJob(job: Job, familyId: string): void {
    if (this.jobs.has(job.id)) return;
    this.jobs.set(job.id, {
      id: job.id,
      familyId,
      instanceId: this.familyInstance.get(familyId),
    });
  }

  /**
   * `POST /jobs/{id}/cancel` (§5.3, R-J2). On an active job `accepted` is true (`202`); on a
   * settled job the call is a `200` no-op and `discardPages` is ignored by the agent.
   */
  async cancelJob(id: string, options: CancelOptions = {}): Promise<CancelResult> {
    const body =
      options.discardPages === undefined ? undefined : { discardPages: options.discardPages };
    const { res } = await this.call({
      op: 'cancelJob',
      method: 'POST',
      path: `${this.jobPath(id)}/cancel`,
      body,
      signal: options.signal,
      job: this.jobs.get(id),
    });
    const job = decodeJob(res.body);
    if (job.state === 'disposed') this.jobs.delete(id);
    return { job, accepted: res.status === 202 };
  }

  /**
   * Opens a job event stream (§6). The stream resumes from `lastEventId` (R-E5), reconnects with
   * bounded backoff, treats a silent stream as dead (R-E6), and ends on the agent's `done`
   * (R-E7). The credential is always the job's family's (R-A15), re-selected on reconnect
   * (R-A16); recovery is the same as every other call, including SDK-local `agent-restarted`.
   */
  streamEvents(id: string, options: EventStreamOptions = {}): JobEventStream {
    if (this.disposed) throw new ZiloDisposedError();
    const path = `${this.jobPath(id)}/events`;
    const heartbeatSeconds =
      typeof this.limits?.sseHeartbeatSeconds === 'number'
        ? this.limits.sseHeartbeatSeconds
        : DEFAULT_SSE_HEARTBEAT_SECONDS;
    const stream = new JobEventStream(
      async ({ lastEventId, signal }) => {
        const { value } = await this.withRecovery(
          { signal, job: this.jobs.get(id) },
          async (credential) => {
            const raw = await this.agent().open({
              op: 'streamJobEvents',
              method: 'GET',
              path,
              token: credential.token,
              signal,
              headers: {
                Accept: 'text/event-stream',
                ...(lastEventId === undefined
                  ? {}
                  : { 'Last-Event-ID': String(lastEventId) }),
              },
            });
            return { value: raw.response, cred: credential };
          },
        );
        return value;
      },
      {
        signal: options.signal,
        lastEventId: options.lastEventId,
        backoff: options.backoff,
        heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? heartbeatTimeoutFor(heartbeatSeconds),
        maxReconnects: options.maxReconnects,
        snapshot: (signal) => this.jobSnapshot(id, signal),
      },
    );
    this.streams.add(stream);
    const release = (): boolean => this.streams.delete(stream);
    void stream.done.then(release, release);
    return stream;
  }

  /** The settled state of a job after a stream closed without `done` (R-E7). */
  private async jobSnapshot(
    id: string,
    signal: AbortSignal,
  ): Promise<JobSettledSnapshot | undefined> {
    const job = await this.getJob(id, signal);
    return {
      state: job.state,
      pageCount: job.pageCount,
      ...(job.error === undefined ? {} : { error: job.error }),
    };
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

  /**
   * Stops detection (re-check and consent polling, as on dismiss), then revokes the current family
   * with `DELETE /auth/token` (R-A12). The instance stays usable: a later call issues a new
   * family. For teardown, use `dispose()`.
   */
  async disconnect(signal?: AbortSignal): Promise<void> {
    if (this.disposed) throw new ZiloDisposedError();
    this.detection.cancel();
    await this.auth.revokeCurrent(signal);
  }
}
