// D-008 detection state machine. State names are the T05 detection states
// (docs/design/detection-dialogs.md §2), so `@zilo/ui` maps them one to one. Every move goes
// through `TRANSITIONS`; an undeclared move is a bug and throws.
import { compareSemver, publicFit, type Fit } from './compat.js';
import { isProblem, ZiloAbortError, ZiloProblemError } from './errors.js';
import {
  queryLoopbackPermission,
  type LoopbackPermission,
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
  | 'ready';

/** Where the flow can land once a probe or an auth step has an answer. */
const OUTCOMES = [
  'unreachable-or-blocked',
  'outdated',
  'awaiting-consent',
  'consent-expired',
  'unauthorized-origin',
  'consent-denied',
  'consent-blocked',
  'rate-limited',
  'outdated-authorized',
  'token-revoked',
  'ready',
] as const satisfies readonly DetectionStateName[];

/** Allowed moves. `idle` is reachable from everywhere (dialog dismissed). */
export const TRANSITIONS: Readonly<Record<DetectionStateName, readonly DetectionStateName[]>> = {
  idle: ['checking', 'insecure-origin', 'safari-unsupported'],
  checking: ['permission-prompt', 'denied', ...OUTCOMES],
  'permission-prompt': OUTCOMES,
  denied: ['checking'],
  // The live re-check moves straight on when the agent answers (T05 §3), or stops at the cap.
  'unreachable-or-blocked': [
    'unreachable-stopped',
    ...OUTCOMES.filter((s) => s !== 'unreachable-or-blocked'),
  ],
  'unreachable-stopped': ['checking'],
  outdated: ['checking'],
  'awaiting-consent': ['awaiting-consent', ...OUTCOMES.filter((s) => s !== 'awaiting-consent')],
  'consent-expired': ['checking'],
  'unauthorized-origin': ['checking'],
  'consent-denied': ['checking'],
  'consent-blocked': [],
  'rate-limited': ['checking'],
  'outdated-authorized': ['checking'],
  'token-revoked': ['checking'],
  'insecure-origin': [],
  'safari-unsupported': [],
  ready: ['checking', 'token-revoked', 'unreachable-or-blocked'],
};

export function canTransition(from: DetectionStateName, to: DetectionStateName): boolean {
  return to === 'idle' || TRANSITIONS[from].includes(to);
}

export interface DetectionSnapshot {
  state: DetectionStateName;
  permission?: LoopbackPermission | undefined;
  /** Port of the agent that answered `hello`. */
  port?: number | undefined;
  hello?: HelloPublic | HelloFull | undefined;
  /** For `outdated`: why the public `hello` does not fit. */
  fit?: Fit | undefined;
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

/**
 * Runs detection. `start()` must be called from a user gesture (Scan click, Try again, Ask again,
 * Check again, Connect again): it is the only path that sends `POST /auth/consent` (R-A1).
 * `cancel()` is the dialog being dismissed: it stops the re-check and consent polling.
 */
export class Detector {
  private snap: DetectionSnapshot = { state: 'idle' };
  private readonly listeners = new Set<DetectionListener>();
  private run: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly d: DetectionDeps;

  constructor(deps: DetectionDeps) {
    this.d = deps;
  }

  get snapshot(): DetectionSnapshot {
    return this.snap;
  }

  subscribe(listener: DetectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Moves the machine; throws on an undeclared transition. */
  private go(next: DetectionSnapshot): void {
    if (!canTransition(this.snap.state, next.state)) {
      throw new Error(`detection: illegal transition ${this.snap.state} -> ${next.state}`);
    }
    this.snap = next;
    for (const l of this.listeners) l(next);
  }

  /** External report (from an authenticated call) that the site's access was revoked. */
  markRevoked(): void {
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

  private stop(): void {
    this.run?.abort();
    this.run = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Starts (or restarts) detection. Resolves with the state the flow settles in first. */
  async start(): Promise<DetectionSnapshot> {
    this.stop();
    const run = new AbortController();
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
    const permission = await queryLoopbackPermission(this.d.permissions);
    if (run.signal.aborted) return this.snap;
    if (permission === 'denied') {
      this.go({ state: 'denied', permission });
      return this.snap;
    }
    if (permission === 'prompt') this.go({ state: 'permission-prompt', permission });
    await this.probeAndContinue(run, permission, Date.now());
    return this.snap;
  }

  private async probeAndContinue(
    run: AbortController,
    permission: LoopbackPermission,
    since: number,
  ): Promise<void> {
    let found: ProbeResult | undefined;
    try {
      found = await this.d.probe(run.signal);
    } catch (err) {
      if (err instanceof ZiloAbortError || run.signal.aborted) return;
      found = undefined;
    }
    if (run.signal.aborted) return;
    if (found === undefined) {
      if (this.snap.state !== 'unreachable-or-blocked')
        this.go({ state: 'unreachable-or-blocked', permission });
      this.scheduleRecheck(run, permission, since);
      return;
    }
    const fit = publicFit(found.hello);
    if (!fit.fits) {
      this.go({ state: 'outdated', permission, port: found.port, hello: found.hello, fit });
      return;
    }
    const base = { permission, port: found.port, hello: found.hello };
    try {
      if (await this.d.hasToken()) {
        await this.authorized(run, base);
        return;
      }
      const consent = await this.d.requestConsent(run.signal);
      await this.onConsent(run, base, consent);
    } catch (err) {
      this.onAuthError(run, base, err);
    }
  }

  private scheduleRecheck(
    run: AbortController,
    permission: LoopbackPermission,
    since: number,
  ): void {
    const interval = this.d.recheckIntervalMs ?? DEFAULT_RECHECK_MS;
    const cap = this.d.recheckCapMs ?? DEFAULT_RECHECK_CAP_MS;
    if (Date.now() + interval - since > cap) {
      this.go({ state: 'unreachable-stopped', permission });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!run.signal.aborted) void this.probeAndContinue(run, permission, since);
    }, interval);
  }

  private async authorized(run: AbortController, base: SnapshotBase): Promise<void> {
    const full = await this.d.authorize(run.signal);
    if (run.signal.aborted) return;
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

  private async onConsent(
    run: AbortController,
    base: SnapshotBase,
    consent: ConsentStatus,
  ): Promise<void> {
    if (run.signal.aborted) return;
    switch (consent.state) {
      case 'granted':
        await this.authorized(run, base);
        return;
      case 'pending':
        this.go({ ...base, state: 'awaiting-consent', promptExpiresAt: consent.promptExpiresAt });
        this.schedulePoll(run, base, consent.pollAfterSeconds ?? DEFAULT_POLL_SECONDS);
        return;
      case 'denied':
        this.go({ ...base, state: 'consent-denied', retryAfterSeconds: consent.retryAfterSeconds });
        return;
      case 'blocked':
        this.go({ ...base, state: 'consent-blocked' });
        return;
      default:
        // `none` (the prompt expired or was dismissed) or an unknown future state, which means
        // "not usable yet" (R-A2, R-A3): stop polling; Ask again needs a new user action.
        this.go({ ...base, state: 'consent-expired' });
    }
  }

  private schedulePoll(run: AbortController, base: SnapshotBase, seconds: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (run.signal.aborted) return;
      void (async () => {
        try {
          await this.onConsent(run, base, await this.d.readConsent(run.signal));
        } catch (err) {
          if (isProblem(err, 'rate-limited')) {
            // GET /auth/consent is limited to 2/s per origin (R-A3): back off and keep polling.
            this.schedulePoll(run, base, Math.max(seconds, err.retryAfterSeconds ?? seconds));
            return;
          }
          this.onAuthError(run, base, err);
        }
      })();
    }, seconds * 1000);
  }

  private onAuthError(run: AbortController, base: SnapshotBase, err: unknown): void {
    if (run.signal.aborted || err instanceof ZiloAbortError) return;
    if (err instanceof ZiloProblemError) {
      switch (err.code) {
        case 'consent-pending':
          // From POST /auth/token: a prompt is open; poll like a 202 (R-A7).
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
        case 'limits-exceeded':
          this.go({ ...base, state: 'rate-limited', retryAfterSeconds: err.retryAfterSeconds });
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
    // Transport failures, timeouts and anything else: the agent cannot be used right now.
    if (this.snap.state !== 'unreachable-or-blocked') {
      this.go({ state: 'unreachable-or-blocked', permission: base.permission });
    }
    this.scheduleRecheck(run, base.permission ?? 'unknown', Date.now());
  }
}
