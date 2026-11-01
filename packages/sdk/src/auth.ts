// Auth and consent client (CONTRACT.md §3): consent request and polling, token issuance, renewal
// that keeps the family, deterministic family rollover and per-origin credential storage (R-A15).
import type { CredentialStore, FamilyCredential, OriginCredentials } from './credentials.js';
import { decodeConsent, decodeToken } from './decode.js';
import { isProblem } from './errors.js';
import type { HttpTransport } from './transport.js';
import type { ConsentStatus } from './types.js';
import { version as sdkVersion } from './version.js';

export interface AuthOptions {
  origin: string;
  store: CredentialStore;
  transport: () => HttpTransport;
  now: () => number;
  /** Families that still own a tracked, non-disposed job; they are never pruned. */
  familiesWithJobs: () => ReadonlySet<string>;
}

const time = (iso: string): number => Date.parse(iso);

/** A final token expires at the family deadline; renewal would return `409` (R-A11). */
export function isFinal(c: FamilyCredential): boolean {
  return time(c.expiresAt) >= time(c.familyExpiresAt);
}

export class AuthClient {
  private readonly o: AuthOptions;

  constructor(options: AuthOptions) {
    this.o = options;
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
  async hasUsableCurrent(): Promise<boolean> {
    const rec = await this.o.store.read(this.o.origin);
    return this.usable(rec?.current === undefined ? undefined : rec.families[rec.current]);
  }

  /** The stored credential of a family, if any (per-job family selection, R-A15). */
  async familyCredential(familyId: string): Promise<FamilyCredential | undefined> {
    const rec = await this.o.store.read(this.o.origin);
    return rec?.families[familyId];
  }

  /**
   * The current family's credential, renewed when due. Starts a new family only under the
   * deterministic rollover rule (R-A15): no usable current entry, or a new scan while the
   * current token is final.
   */
  async currentCredential(
    options: { newScan?: boolean; signal?: AbortSignal | undefined } = {},
  ): Promise<FamilyCredential> {
    return this.o.store.withLock(this.o.origin, async () => {
      const rec: OriginCredentials = (await this.o.store.read(this.o.origin)) ?? { families: {} };
      const cur = rec.current === undefined ? undefined : rec.families[rec.current];
      if (this.usable(cur) && !(options.newScan === true && isFinal(cur))) {
        return this.renewIfDue(rec, cur, options.signal);
      }
      return this.issue(rec, options.signal);
    });
  }

  /** Renews the family's token when due (R-A11, R-A15). Never changes the current pointer. */
  async freshCredential(
    familyId: string,
    signal?: AbortSignal,
  ): Promise<FamilyCredential | undefined> {
    return this.o.store.withLock(this.o.origin, async () => {
      const rec = await this.o.store.read(this.o.origin);
      const entry = rec?.families[familyId];
      if (rec === undefined || !this.usable(entry)) return entry;
      return this.renewIfDue(rec, entry, signal);
    });
  }

  private async renewIfDue(
    rec: OriginCredentials,
    entry: FamilyCredential,
    signal?: AbortSignal,
  ): Promise<FamilyCredential> {
    if (isFinal(entry) || this.o.now() < time(entry.renewAfter)) return entry;
    try {
      const res = await this.o.transport().request({
        op: 'renewToken',
        method: 'POST',
        path: '/zilo/v1/auth/token/renew',
        token: entry.token,
        signal,
      });
      const t = decodeToken(res.body);
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
      throw err;
    }
  }

  private async issue(rec: OriginCredentials, signal?: AbortSignal): Promise<FamilyCredential> {
    const res = await this.o.transport().request({
      op: 'issueToken',
      method: 'POST',
      path: '/zilo/v1/auth/token',
      body: { sdk: { name: '@zilo/sdk', version: sdkVersion } },
      signal,
    });
    const t = decodeToken(res.body);
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
   * Before a new family becomes current: drops every entry that ended or no longer owns a tracked
   * job (the old current entry included). Entries that still own jobs are never dropped, so with a
   * full map the agent's own bound answers instead (R-A9, R-A15).
   */
  private prune(rec: OriginCredentials): void {
    const withJobs = this.o.familiesWithJobs();
    for (const [id, c] of Object.entries(rec.families)) {
      if (!this.usable(c) || !withJobs.has(id)) Reflect.deleteProperty(rec.families, id);
    }
  }

  /**
   * R-A10 step 1 after `401 token-invalid`: re-reads storage. Returns another stored token of the
   * same family to retry once with, or drops the family's entry and returns `undefined`.
   */
  async recoverInvalid(
    familyId: string,
    failedToken: string,
  ): Promise<FamilyCredential | undefined> {
    return this.o.store.withLock(this.o.origin, async () => {
      const rec = await this.o.store.read(this.o.origin);
      if (rec === undefined) return undefined;
      const entry = rec.families[familyId];
      if (entry !== undefined && entry.token !== failedToken && this.usable(entry)) return entry;
      this.drop(rec, familyId);
      await this.o.store.write(this.o.origin, rec);
      return undefined;
    });
  }

  /** Removes one family's entry (revoked or ended). */
  async dropFamily(familyId: string): Promise<void> {
    await this.o.store.withLock(this.o.origin, async () => {
      const rec = await this.o.store.read(this.o.origin);
      if (rec === undefined) return;
      this.drop(rec, familyId);
      await this.o.store.write(this.o.origin, rec);
    });
  }

  /** Drops every family except `keep` (agent restart: the families ended with the old process). */
  async dropAllExcept(keep: string | undefined): Promise<void> {
    await this.o.store.withLock(this.o.origin, async () => {
      const rec = await this.o.store.read(this.o.origin);
      if (rec === undefined) return;
      for (const id of Object.keys(rec.families)) if (id !== keep) this.drop(rec, id);
      await this.o.store.write(this.o.origin, rec);
    });
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
