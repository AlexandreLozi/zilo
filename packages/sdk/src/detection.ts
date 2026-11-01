// D-008 detection state machine. State names are the T05 detection states
// (docs/design/detection-dialogs.md §2), so `@zilo/ui` maps them one to one. Every move goes
// through `TRANSITIONS`; an undeclared move is a bug and throws. Two SDK states have no T05 copy
// yet (`sdk-too-old`, `auth-unavailable`); the UI shows a safe generic message for them.
import { compareSemver, publicFit, type Fit } from './compat.js';
import { isProblem, ZiloAbortError, ZiloDisposedError, ZiloProblemError } from './errors.js';
import {
  queryLoopbackPermissionDetail,
  type LoopbackPermission,
  type LoopbackPermissionName,
  type PermissionsLike,
} from './permission.js';
import type { ConsentStatus, HelloFull, HelloPublic } from './types.js';

export type DetectionStateName =
  | 'idle'
  | 'checking'
  | 'permission-prompt'
  | 'denied'
  | 'unreachable-or-blocked'
  | 'unreachable-stopped'
  | 'outdated'
  | 'sdk-too-old'
  | 'awaiting-consent'
  | 'consent-expired'
  | 'unauthorized-origin'
  | 'consent-denied'
  | 'consent-blocked'
  | 'rate-limited'
  | 'outdated-authorized'
  | 'token-revoked'
  | 'insecure-origin'
  | 'safari-unsupported'
  | 'auth-unavailable'
  | 'ready';

/** Where the flow can land once a probe or an auth step has an answer. */
const OUTCOMES = [
  'unreachable-or-blocked',
  // The run's overall deadline passed (T05 §3): reachable from every active flow state.
  'unreachable-stopped',
  'outdated',
  'sdk-too-old',
  'awaiting-consent',
  'consent-expired',
  'unauthorized-origin',
  'consent-denied',
  'consent-blocked',
  'rate-limited',
  'outdated-authorized',
  'token-revoked',
  'auth-unavailable',
  'ready',
] as const satisfies readonly DetectionStateName[];

/** Allowed moves. `idle` is reachable from everywhere (dialog dismissed). */
export const TRANSITIONS: Readonly<Record<DetectionStateName, readonly DetectionStateName[]>> = {
  idle: ['checking', 'insecure-origin', 'safari-unsupported'],
  checking: ['permission-prompt', 'denied', ...OUTCOMES],
  'permission-prompt': OUTCOMES,
  denied: ['checking'],
  // The live re-check moves straight on when the agent answers (T05 §3), or stops at the cap.
  'unreachable-or-blocked': OUTCOMES.filter((s) => s !== 'unreachable-or-blocked'),
  'unreachable-stopped': ['checking'],
  outdated: ['checking'],
  'sdk-too-old': ['checking'],
  'awaiting-consent': OUTCOMES.filter((s) => s !== 'awaiting-consent'),
  'consent-expired': ['checking'],
  'unauthorized-origin': ['checking'],
  'consent-denied': ['checking'],
  'consent-blocked': [],
  'rate-limited': ['checking'],
  'outdated-authorized': ['checking'],
  'token-revoked': ['checking'],
  'insecure-origin': [],
  'safari-unsupported': [],
  'auth-unavailable': ['checking'],
  ready: ['checking', 'token-revoked', 'unreachable-or-blocked'],
};

export function canTransition(from: DetectionStateName, to: DetectionStateName): boolean {
  return to === 'idle' || TRANSITIONS[from].includes(to);
}

/**
 * Why detection stopped in `auth-unavailable`, kept typed (triage #4). Neither is a consent
 * expiry or a rate limit, and neither ever leads to a token request.
 */
export type AuthUnavailableCause =
  /** `GET`/`POST /auth/consent` returned a state this SDK does not know (R-A2: not usable yet). */
  | { kind: 'consent-state-unknown'; consentState: string }
  /** A real resource bound (`limits-exceeded`, §10), for example the family bound of R-A9. */
  | { kind: 'limits-exceeded'; error: ZiloProblemError<'limits-exceeded'> };

export interface DetectionSnapshot {
  state: DetectionStateName;
  /** The `loopback-network` permission; `unknown` when only an unverified name answered. */
  permission?: LoopbackPermission | undefined;
  /**
   * The answer of the unverified legacy name (`local-network-access`), for diagnostics only:
   * never proof of the loopback permission (triage #7).
   */
  permissionHint?: { name: LoopbackPermissionName; state: LoopbackPermission } | undefined;
  /** Port of the agent that answered `hello`. */
  port?: number | undefined;
  hello?: HelloPublic | HelloFull | undefined;
  /**
   * For `outdated` (`agent-too-old`, `missing-capabilities`: update Zilo) and `sdk-too-old`
   * (`sdk-too-old`: the agent is newer than this SDK; the site or app must be updated, never the
   * agent).
   */
  fit?: Fit | undefined;
  /** For `auth-unavailable`: the typed cause. */
  cause?: AuthUnavailableCause | undefined;
  /** For `outdated-authorized`: the installed and required versions. */
  agentVersion?: string | undefined;
  requiredVersion?: string | undefined;
  /** For `consent-denied` and `rate-limited`: seconds before Ask again / Try again. */
  retryAfterSeconds?: number | undefined;
  /** For `awaiting-consent`: when the native prompt expires. */
  promptExpiresAt?: string | undefined;
}

/** Snapshot fields carried across states of one detection run. */
type SnapshotBase = Omit<DetectionSnapshot, 'state'>;

/** The permission fields of a run's snapshots. */
type PermissionBase = Pick<DetectionSnapshot, 'permission' | 'permissionHint'>;

export interface ProbeResult {
  port: number;
  hello: HelloPublic | HelloFull;
}

export interface DetectionDeps {
  /** The page origin, serialised. */
  origin: string;
  isSafari: boolean;
  permissions?: PermissionsLike | undefined;
  probe(signal: AbortSignal): Promise<ProbeResult | undefined>;
  hasToken(): Promise<boolean>;
  requestConsent(signal: AbortSignal): Promise<ConsentStatus>;
  readConsent(signal: AbortSignal): Promise<ConsentStatus>;
  /** Gets the current family's credential and reads the full `hello` with it. */
  authorize(signal: AbortSignal): Promise<HelloFull>;
  /** The site's minimum agent version (D-008 step 4), checked against the full `hello`. */
  minAgentVersion?: string | undefined;
  /** D-008 step 6: re-probe interval while the Install dialog is open (2 s). */
  recheckIntervalMs?: number | undefined;
  /** Overall re-check cap (T05: 5 min). */
  recheckCapMs?: number | undefined;
}

export type DetectionListener = (snapshot: DetectionSnapshot) => void;

const DEFAULT_RECHECK_MS = 2_000;
const DEFAULT_RECHECK_CAP_MS = 5 * 60_000;
const DEFAULT_POLL_SECONDS = 2;

/** Read through a call, so a check after an `await` is not narrowed away. */
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

/** One detection run: one user gesture (`start()`), its overall deadline and its consent request. */
interface Run {
  readonly ctl: AbortController;
  /** When the run started; the overall re-check cap counts from here, across auth retries. */
  readonly since: number;
  /**
   * Set once this run sent `POST /auth/consent`. A run sends it at most once (R-A1, triage #3):
   * a later re-probe of the same run reads the state with `GET`, which never prompts.
   */
  asked: boolean;
}

/**
 * Runs detection. `start()` must be called from a user gesture (Scan click, Try again, Ask again,
 * Check again, Connect again): it is the only path that sends `POST /auth/consent` (R-A1), at most
 * once per call. A run continues on its own only while its dialog is shown and its overall
 * deadline (`recheckCapMs`) has not passed: `cancel()` is the dialog being dismissed, `dispose()`
 * the page or host dialog going away (navigation, Unload); both stop the re-check and polling.
 */
export class Detector {
  private snap: DetectionSnapshot = { state: 'idle' };
  private readonly listeners = new Set<DetectionListener>();
  private run: Run | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly d: DetectionDeps;

  constructor(deps: DetectionDeps) {
    this.d = deps;
  }

  get snapshot(): DetectionSnapshot {
    return this.snap;
  }

  subscribe(listener: DetectionListener): () => void {
    if (this.disposed) return () => false;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Moves the machine; throws on an undeclared transition. */
  private go(next: DetectionSnapshot): void {
    if (this.disposed) return;
    if (!canTransition(this.snap.state, next.state)) {
      throw new Error(`detection: illegal transition ${this.snap.state} -> ${next.state}`);
    }
    this.snap = next;
    for (const l of this.listeners) l(next);
  }

  /** External report (from an authenticated call) that the site's access was revoked. */
  markRevoked(): void {
    if (this.disposed) return;
    this.stop();
    if (this.snap.state !== 'token-revoked' && canTransition(this.snap.state, 'token-revoked')) {
      this.go({ ...this.snap, state: 'token-revoked' });
    }
  }

  /** External report that the agent stopped answering while `ready`. */
  markUnreachable(): void {
    if (this.snap.state === 'ready')
      this.go({ state: 'unreachable-or-blocked', permission: this.snap.permission });
  }

  cancel(): void {
    this.stop();
    if (this.snap.state !== 'ready' && this.snap.state !== 'idle') this.go({ state: 'idle' });
  }

  /**
   * Teardown (idempotent): cancels the run, its timers and pending requests, and drops every
   * subscriber. A disposed detector never moves, notifies or starts again.
   */
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.listeners.clear();
    this.snap = { state: 'idle' };
  }

  private stop(): void {
    this.run?.ctl.abort();
    this.run = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Starts (or restarts) detection. Resolves with the state the flow settles in first. */
  async start(): Promise<DetectionSnapshot> {
    if (this.disposed) throw new ZiloDisposedError();
    this.stop();
    const run: Run = { ctl: new AbortController(), since: Date.now(), asked: false };
    this.run = run;
    if (this.snap.state !== 'idle' && !canTransition(this.snap.state, 'checking'))
      this.go({ state: 'idle' });

    if (!this.d.origin.startsWith('https://')) {
      this.go({ state: 'insecure-origin' });
      return this.snap;
    }
    if (this.d.isSafari) {
      // D-003 / OD-8: no Safari path is approved yet (T25); never silent, never the Install dialog.
      this.go({ state: 'safari-unsupported' });
      return this.snap;
    }
    this.go({ state: 'checking' });
    const detail = await queryLoopbackPermissionDetail(this.d.permissions);
    if (run.ctl.signal.aborted) return this.snap;
    // Only a `loopback-network` answer is acted on; the legacy name is a hint (triage #7).
    const perm: PermissionBase = detail.verified
      ? { permission: detail.state }
      : {
          permission: 'unknown',
          permissionHint:
            detail.name === undefined ? undefined : { name: detail.name, state: detail.state },
        };
    if (perm.permission === 'denied') {
      this.go({ state: 'denied', ...perm });
      return this.snap;
    }
    if (perm.permission === 'prompt') this.go({ state: 'permission-prompt', ...perm });
    await this.probeAndContinue(run, perm);
    return this.snap;
  }

  /** The run's overall deadline (`since` plus the cap), shared by re-checks and consent polls. */
  private deadline(run: Run): number {
    return run.since + (this.d.recheckCapMs ?? DEFAULT_RECHECK_CAP_MS);
  }

  /**
   * Stops the run at its overall deadline (r2 #1): every continuation calls this after an await
   * and before prompting, `POST`ing consent or authorizing. Returns true when the run stopped.
   */
  private stopIfExpired(run: Run, perm: PermissionBase): boolean {
    if (Date.now() <= this.deadline(run)) return false;
    this.stopAtDeadline(run, perm);
    return true;
  }

  private stopAtDeadline(run: Run, perm: PermissionBase): void {
    if (this.run === run) this.stop();
    if (this.snap.state === 'unreachable-stopped') return;
    this.go({
      state: 'unreachable-stopped',
      permission: perm.permission,
      permissionHint: perm.permissionHint,
    });
  }

  private async probeAndContinue(run: Run, perm: PermissionBase): Promise<void> {
    const signal = run.ctl.signal;
    let found: ProbeResult | undefined;
    try {
      found = await this.d.probe(signal);
    } catch (err) {
      if (err instanceof ZiloAbortError || signal.aborted) return;
      found = undefined;
    }
    if (signal.aborted) return;
    if (found !== undefined && this.stopIfExpired(run, perm)) return;
    if (found === undefined) {
      if (this.snap.state !== 'unreachable-or-blocked')
        this.go({ state: 'unreachable-or-blocked', ...perm });
      this.scheduleRecheck(run, perm);
      return;
    }
    const fit = publicFit(found.hello);
    if (!fit.fits) {
      // The SDK being too old is not an agent problem: never "update Zilo" (triage #5).
      const state = fit.reason === 'sdk-too-old' ? 'sdk-too-old' : 'outdated';
      this.go({ state, ...perm, port: found.port, hello: found.hello, fit });
      return;
    }
    const base: SnapshotBase = { ...perm, port: found.port, hello: found.hello };
    try {
      if (await this.d.hasToken()) {
        await this.authorized(run, base);
        return;
      }
      if (isAborted(signal)) return; // dismissed while the token check ran
      if (this.stopIfExpired(run, perm)) return;
      let consent: ConsentStatus;
      if (run.asked) {
        consent = await this.d.readConsent(signal);
      } else {
        run.asked = true;
        consent = await this.d.requestConsent(signal);
      }
      await this.onConsent(run, base, consent);
    } catch (err) {
      this.onAuthError(run, base, err);
    }
  }

  /** Re-probes while the run's overall deadline allows another attempt; then stops. */
  private scheduleRecheck(run: Run, perm: PermissionBase): void {
    const interval = this.d.recheckIntervalMs ?? DEFAULT_RECHECK_MS;
    const cap = this.d.recheckCapMs ?? DEFAULT_RECHECK_CAP_MS;
    if (Date.now() + interval - run.since > cap) {
      this.go({ state: 'unreachable-stopped', ...perm });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!run.ctl.signal.aborted) void this.probeAndContinue(run, perm);
    }, interval);
  }

  private async authorized(run: Run, base: SnapshotBase): Promise<void> {
    if (this.stopIfExpired(run, base)) return;
    const full = await this.d.authorize(run.ctl.signal);
    if (run.ctl.signal.aborted) return;
    if (this.stopIfExpired(run, base)) return;
    const required = this.d.minAgentVersion;
    if (required !== undefined && compareSemver(full.version, required) < 0) {
      this.go({
        ...base,
        state: 'outdated-authorized',
        hello: full,
        agentVersion: full.version,
        requiredVersion: required,
      });
      return;
    }
    this.go({ ...base, state: 'ready', hello: full });
  }

  private async onConsent(run: Run, base: SnapshotBase, consent: ConsentStatus): Promise<void> {
    if (run.ctl.signal.aborted) return;
    switch (consent.state) {
      case 'granted':
        await this.authorized(run, base);
        return;
      case 'pending':
        if (this.snap.state !== 'awaiting-consent') {
          this.go({ ...base, state: 'awaiting-consent', promptExpiresAt: consent.promptExpiresAt });
        }
        this.schedulePoll(run, base, consent.pollAfterSeconds ?? DEFAULT_POLL_SECONDS);
        return;
      case 'denied':
        this.go({ ...base, state: 'consent-denied', retryAfterSeconds: consent.retryAfterSeconds });
        return;
      case 'blocked':
        this.go({ ...base, state: 'consent-blocked' });
        return;
      case 'none':
        // The prompt expired or was dismissed: stop polling; Ask again needs a new user action.
        this.go({ ...base, state: 'consent-expired' });
        return;
      default:
        // An unknown future state means "not usable yet" (R-A2, R-A3): stop polling, never ask
        // for a token, and keep the state as the typed cause (triage #4).
        this.go({
          ...base,
          state: 'auth-unavailable',
          cause: { kind: 'consent-state-unknown', consentState: consent.state },
        });
    }
  }

  /**
   * Polls consent until the run's overall deadline. The last wait is cut to end at the deadline,
   * so a slow `pollAfterSeconds` or a rate-limit backoff never runs past it.
   */
  private schedulePoll(run: Run, base: SnapshotBase, seconds: number): void {
    const remaining = this.deadline(run) - Date.now();
    if (remaining <= 0) {
      this.stopAtDeadline(run, base);
      return;
    }
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (run.ctl.signal.aborted) return;
        if (this.stopIfExpired(run, base)) return;
        void this.poll(run, base, seconds);
      },
      Math.min(seconds * 1000, remaining),
    );
  }

  private async poll(run: Run, base: SnapshotBase, seconds: number): Promise<void> {
    try {
      const consent = await this.d.readConsent(run.ctl.signal);
      if (run.ctl.signal.aborted || this.stopIfExpired(run, base)) return;
      await this.onConsent(run, base, consent);
    } catch (err) {
      if (isProblem(err, 'rate-limited')) {
        // GET /auth/consent is limited to 2/s per origin (R-A3): back off and keep polling.
        this.schedulePoll(run, base, Math.max(seconds, err.retryAfterSeconds ?? seconds));
        return;
      }
      this.onAuthError(run, base, err);
    }
  }

  private onAuthError(run: Run, base: SnapshotBase, err: unknown): void {
    if (run.ctl.signal.aborted || err instanceof ZiloAbortError) return;
    if (err instanceof ZiloProblemError) {
      switch (err.code) {
        case 'consent-pending':
          // From POST /auth/token: a prompt is open; poll like a 202 (R-A7).
          if (this.snap.state !== 'awaiting-consent')
            this.go({ ...base, state: 'awaiting-consent' });
          this.schedulePoll(run, base, err.retryAfterSeconds ?? DEFAULT_POLL_SECONDS);
          return;
        case 'consent-denied':
          this.go(
            err.blocked
              ? { ...base, state: 'consent-blocked' }
              : { ...base, state: 'consent-denied', retryAfterSeconds: err.retryAfterSeconds },
          );
          return;
        case 'rate-limited':
          this.go({ ...base, state: 'rate-limited', retryAfterSeconds: err.retryAfterSeconds });
          return;
        case 'limits-exceeded':
          // A resource bound, not a rate limit (triage #4): keep the typed cause.
          this.go({
            ...base,
            state: 'auth-unavailable',
            retryAfterSeconds: err.retryAfterSeconds,
            cause: { kind: 'limits-exceeded', error: err as ZiloProblemError<'limits-exceeded'> },
          });
          return;
        case 'unauthorized-origin':
          this.go({ ...base, state: 'unauthorized-origin' });
          return;
        case 'token-revoked':
          this.go({ ...base, state: 'token-revoked' });
          return;
        default:
          break;
      }
    }
    // Transport failures, timeouts and anything else: the agent cannot be used right now. The
    // re-check keeps the run's original deadline, so the overall cap is always reached.
    const perm: PermissionBase = {
      permission: base.permission ?? 'unknown',
      permissionHint: base.permissionHint,
    };
    if (this.snap.state !== 'unreachable-or-blocked') {
      this.go({ state: 'unreachable-or-blocked', ...perm });
    }
    this.scheduleRecheck(run, perm);
  }
}
