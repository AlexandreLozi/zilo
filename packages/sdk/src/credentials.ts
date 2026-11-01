// Family-indexed credential storage per origin (CONTRACT.md R-A15).
//
// Storage choice (T13): the default is in-memory, per SDK instance. It keeps tokens out of any
// storage that outlives the page or that other scripts can enumerate, at the cost of tab sharing:
// each tab then holds its own family. An app that wants tabs to share jobs supplies an adapter
// over storage shared by its same-origin tabs, with cross-tab mutual exclusion (for example the
// Web Locks API). Such an adapter exposes bearer tokens to any script running in the app origin
// (XSS), exactly like the in-memory store does to scripts in the page; it must not persist tokens
// beyond `familyExpiresAt`. The contract approves no browser-storage technology (R-A15).

/** One family's current token (R-A15). Times are RFC 3339 strings as the agent sent them. */
export interface FamilyCredential {
  familyId: string;
  token: string;
  expiresAt: string;
  renewAfter: string;
  familyExpiresAt: string;
}

/** Per-origin record: the family map and the current-family pointer. */
export interface OriginCredentials {
  current?: string | undefined;
  families: Record<string, FamilyCredential>;
}

export interface CredentialStore {
  read(origin: string): Promise<OriginCredentials | undefined>;
  /** `undefined` deletes the origin's record. */
  write(origin: string, value: OriginCredentials | undefined): Promise<void>;
  /**
   * Runs `fn` under mutual exclusion for the origin, across every tab that shares the store.
   * Acquisition, renewal and pointer moves run inside it (R-A15).
   */
  withLock<T>(origin: string, fn: () => Promise<T>): Promise<T>;
}

function clone(value: OriginCredentials): OriginCredentials {
  return {
    current: value.current,
    families: Object.fromEntries(Object.entries(value.families).map(([k, v]) => [k, { ...v }])),
  };
}

/** Default store: in memory, one SDK instance. Values are copied in and out. */
export class MemoryCredentialStore implements CredentialStore {
  private readonly records = new Map<string, OriginCredentials>();
  private readonly locks = new Map<string, Promise<unknown>>();

  read(origin: string): Promise<OriginCredentials | undefined> {
    const value = this.records.get(origin);
    return Promise.resolve(value === undefined ? undefined : clone(value));
  }

  write(origin: string, value: OriginCredentials | undefined): Promise<void> {
    if (value === undefined) this.records.delete(origin);
    else this.records.set(origin, clone(value));
    return Promise.resolve();
  }

  withLock<T>(origin: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(origin) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    const settled = next.catch(() => undefined);
    this.locks.set(origin, settled);
    void settled.then(() => {
      if (this.locks.get(origin) === settled) this.locks.delete(origin);
    });
    return next;
  }
}
