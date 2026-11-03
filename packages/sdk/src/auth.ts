// Auth and consent client (CONTRACT.md §3): consent request and polling, token issuance, renewal
// that keeps the family, deterministic family rollover and per-origin credential storage (R-A15).
import { throwIfAborted, untilAborted } from './abort.js';
import type { CredentialStore, FamilyCredential, OriginCredentials } from './credentials.js';
import { decodeConsent, decodeToken } from './decode.js';
import { isProblem, ZiloDisposedError } from './errors.js';
import type { HttpTransport } from './transport.js';
import type { ConsentStatus } from './types.js';
import { version as sdkVersion } from './version.js';

export interface AuthOptions {
  origin: string;
  store: CredentialStore;
  transport: () => HttpTransport;
  now: () => number;
  /** True once the owning client was disposed: nothing is stored after that. */
  closed?: (() => boolean) | undefined;
}

const time = (iso: string): number => Date.parse(iso);

/** A final token expires at the family deadline; renewal would return `409` (R-A11). */
export function isFinal(c: FamilyCredential): boolean {
  return time(c.expiresAt) >= time(c.familyExpiresAt);
}

export class AuthClient {
  private readonly o: AuthOptions;
  /** Renewal failures, mapped to the stored credential the renewal presented (R-A10). */
  private readonly renewalFailures = new WeakMap<object, FamilyCredential>();

  constructor(options: AuthOptions) {
    this.o = options;
  }

  /**
   * The credential a failed renewal presented, when `err` came from renewal. The caller runs the
   * same R-A10 / R-A12 / R-A13 recovery for it as for a failed protected request.
   */
  renewalCredential(err: unknown): FamilyCredential | undefined {
    return typeof err === 'object' && err !== null ? this.renewalFailures.get(err) : undefined;
  }

  private assertOpen(): void {
    if (this.o.closed?.() === true) throw new ZiloDisposedError();
  }

  /**
   * Checked right before every side effect (a token request, a credential write) and as a lock's
   * critical section starts: nothing starts once the client was disposed or the caller's signal
   * aborted (a detection run's deadline, cancel or replacement). The write that records a token
   * follows its answer with no await in between, so an abort can only drop a token the agent
   * already minted, never cause a second issuance.
   */
  private assertLive(signal: AbortSignal | undefined): void {
    this.assertOpen();
    throwIfAborted(signal);
  }

  /** `POST /auth/consent` (R-A1): the only call that can prompt. Only from a user gesture. */
  async requestConsent(signal?: AbortSignal): Promise<ConsentStatus> {
    const res = await this.o
      .transport()
      .request({ op: 'requestConsent', method: 'POST', path: '/zilo/v1/auth/consent', signal });
    return decodeConsent(res.body);
  }

  /** `GET /auth/consent` (R-A3): never prompts. */
  async readConsent(signal?: AbortSignal): Promise<ConsentStatus> {
    const res = await this.o
      .transport()
      .request({ op: 'getConsent', method: 'GET', path: '/zilo/v1/auth/consent', signal });
    return decodeConsent(res.body);
  }

  private usable(c: FamilyCredential | undefined): c is FamilyCredential {
    if (c === undefined) return false;
    const now = this.o.now();
    return now < time(c.expiresAt) && now < time(c.familyExpiresAt);
  }

  /** True when storage holds a usable current-family token ("token held?" in T05 detection). */
  async hasUsableCurrent(signal?: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    const rec = await untilAborted(this.o.store.read(this.o.origin), signal);
    return this.usable(rec?.current === undefined ? undefined : rec.families[rec.current]);
  }

  /** The stored credential of a family, if any (per-job family selection, R-A15). */
  async familyCredential(familyId: string): Promise<FamilyCredential | undefined> {
    const rec = await this.o.store.read(this.o.origin);
    return rec?.families[familyId];
  }

  /**
   * Every stored family credential of the origin, current family first and unusable entries
   * omitted (R-A15: `GET /jobs` is issued per family and the results are merged). Never issues.
   */
  async allCredentials(signal?: AbortSignal): Promise<FamilyCredential[]> {
    throwIfAborted(signal);
    const rec = await untilAborted(this.o.store.read(this.o.origin), signal);
    if (rec === undefined) return [];
    const usable = Object.values(rec.families).filter((c) => this.usable(c));
    const current = rec.current === undefined ? undefined : rec.families[rec.current];
    if (current === undefined || !usable.includes(current)) return usable;
    return [current, ...usable.filter((c) => c !== current)];
  }

  /**
   * The current family's credential, renewed when due. Starts a new family only under the
   * deterministic rollover rule (R-A15): no usable current entry, or a new scan while the
   * current token is final.
   */
  async currentCredential(
    options: { newScan?: boolean; signal?: AbortSignal | undefined } = {},
  ): Promise<FamilyCredential> {
    const { signal } = options;
    this.assertLive(signal);
    return this.o.store.withLock(
      this.o.origin,
      async () => {
        this.assertLive(signal);
        const rec: OriginCredentials = (await this.o.store.read(this.o.origin)) ?? {
          families: {},
        };
        const cur = rec.current === undefined ? undefined : rec.families[rec.current];
        if (this.usable(cur) && !(options.newScan === true && isFinal(cur))) {
          return this.renewIfDue(rec, cur, signal);
        }
        return this.issue(rec, signal);
      },
      signal,
    );
  }

  /** Renews the family's token when due (R-A11, R-A15). Never changes the current pointer. */
  async freshCredential(
    familyId: string,
    signal?: AbortSignal,
  ): Promise<FamilyCredential | undefined> {
    this.assertLive(signal);
    return this.o.store.withLock(
      this.o.origin,
      async () => {
        this.assertLive(signal);
        const rec = await this.o.store.read(this.o.origin);
        const entry = rec?.families[familyId];
        if (rec === undefined || !this.usable(entry)) return entry;
        return this.renewIfDue(rec, entry, signal);
      },
      signal,
    );
  }

  private async renewIfDue(
    rec: OriginCredentials,
    entry: FamilyCredential,
    signal?: AbortSignal,
  ): Promise<FamilyCredential> {
    if (isFinal(entry) || this.o.now() < time(entry.renewAfter)) return entry;
    this.assertLive(signal);
    try {
      const res = await this.o.transport().request({
        op: 'renewToken',
        method: 'POST',
        path: '/zilo/v1/auth/token/renew',
        token: entry.token,
        signal,
      });
      const t = decodeToken(res.body);
      this.assertLive(signal);
      const next: FamilyCredential = {
        familyId: entry.familyId, // renewal keeps the family (R-A11)
        token: t.token,
        expiresAt: t.expiresAt,
        renewAfter: t.renewAfter,
        familyExpiresAt: t.familyExpiresAt,
      };
      rec.families[entry.familyId] = next;
      await this.o.store.write(this.o.origin, rec);
      return next;
    } catch (err) {
      // 409: another tab renewed first (storage was re-read under the lock) or the token is final;
      // 429: too early. Either way the stored token stays usable until its expiry.
      if (isProblem(err, 'invalid-state') || isProblem(err, 'rate-limited')) return entry;
      if (typeof err === 'object' && err !== null) this.renewalFailures.set(err, entry);
      throw err;
    }
  }

  private async issue(rec: OriginCredentials, signal?: AbortSignal): Promise<FamilyCredential> {
    this.assertLive(signal);
    const res = await this.o.transport().request({
      op: 'issueToken',
      method: 'POST',
      path: '/zilo/v1/auth/token',
      body: { sdk: { name: '@zilo/sdk', version: sdkVersion } },
      signal,
    });
    const t = decodeToken(res.body);
    this.assertLive(signal);
    const entry: FamilyCredential = {
      familyId: t.familyId,
      token: t.token,
      expiresAt: t.expiresAt,
      renewAfter: t.renewAfter,
      familyExpiresAt: t.familyExpiresAt,
    };
    this.prune(rec);
    rec.families[entry.familyId] = entry;
    rec.current = entry.familyId;
    await this.o.store.write(this.o.origin, rec);
    return entry;
  }

  /**
   * Before a new family becomes current: drops only the entries whose family **provably ended**,
   * by time: its deadline passed, or its stored token expired without a stored successor (lapse,
   * R-A9 item 2; a successor stored by any tab would have replaced it). Storage is shared by
   * clients this one cannot see, and the local job registry says nothing about their jobs, so a
   * live entry is never dropped here: the old current entry included, it stays for jobs of other
   * clients (R-A15) and ends by its own deadline. Other ended families are dropped where their end
   * is observed: `401 token-invalid` with no other stored token, `token-revoked`, or an agent
   * restart. With a full map, the agent's own bound answers (R-A9).
   */
  private prune(rec: OriginCredentials): void {
    for (const [id, c] of Object.entries(rec.families)) {
      if (!this.usable(c)) Reflect.deleteProperty(rec.families, id);
    }
  }

  /**
   * R-A10 step 1 after `401 token-invalid`: re-reads storage. Returns another stored token of the
   * same family to retry once with, or drops the family's entry and returns `undefined`.
   */
  async recoverInvalid(
    familyId: string,
    failedToken: string,
    signal?: AbortSignal,
  ): Promise<FamilyCredential | undefined> {
    this.assertLive(signal);
    return this.o.store.withLock(
      this.o.origin,
      async () => {
        this.assertLive(signal);
        const rec = await this.o.store.read(this.o.origin);
        if (rec === undefined) return undefined;
        const entry = rec.families[familyId];
        if (entry !== undefined && entry.token !== failedToken && this.usable(entry)) return entry;
        this.drop(rec, familyId);
        this.assertLive(signal);
        await this.o.store.write(this.o.origin, rec);
        return undefined;
      },
      signal,
    );
  }

  /**
   * Removes one family's entry (revoked or ended). Guarded like every write: nothing starts once
   * the client was disposed or `signal` aborted, before the lock, as the section starts and right
   * before the write.
   */
  async dropFamily(familyId: string, signal?: AbortSignal): Promise<void> {
    await this.dropWhere((id) => id === familyId, signal);
  }

  /**
   * Drops every family except `keep` (agent restart: the families ended with the old process).
   * Guarded like `dropFamily`; an aborted call writes nothing, and the caller retries later.
   */
  async dropAllExcept(keep: string | undefined, signal?: AbortSignal): Promise<void> {
    await this.dropWhere((id) => id !== keep, signal);
  }

  private async dropWhere(
    match: (familyId: string) => boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertLive(signal);
    await this.o.store.withLock(
      this.o.origin,
      async () => {
        this.assertLive(signal);
        const rec = await this.o.store.read(this.o.origin);
        if (rec === undefined) return;
        for (const id of Object.keys(rec.families)) if (match(id)) this.drop(rec, id);
        this.assertLive(signal);
        await this.o.store.write(this.o.origin, rec);
      },
      signal,
    );
  }

  private drop(rec: OriginCredentials, familyId: string): void {
    Reflect.deleteProperty(rec.families, familyId);
    if (rec.current === familyId) rec.current = undefined;
  }

  /** `DELETE /auth/token`: revokes the current family (self-revocation, R-A12). */
  async revokeCurrent(signal?: AbortSignal): Promise<void> {
    const rec = await this.o.store.read(this.o.origin);
    const cur = rec?.current === undefined ? undefined : rec.families[rec.current];
    if (cur === undefined) return;
    try {
      await this.o.transport().request({
        op: 'revokeToken',
        method: 'DELETE',
        path: '/zilo/v1/auth/token',
        token: cur.token,
        signal,
      });
    } finally {
      await this.dropFamily(cur.familyId);
    }
  }
}
