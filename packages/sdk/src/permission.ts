// Browser loopback permission (D-008 step 1). The Permissions API name is not available in every
// browser; where the query is missing or throws, the state is `unknown` and detection continues.
// An unsupported query is never `denied`.

export type LoopbackPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** The part of `navigator.permissions` the SDK uses; injectable for tests. */
export interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ state: string }>;
}

/**
 * Permission names, most specific first. `loopback-network` is the D-008 name and the only one
 * whose answer the SDK acts on. `local-network-access` is an older Chromium name; **unverified**:
 * no browser evidence yet shows that it guards the same loopback access (triage #7, SP-1a / T01),
 * so its answer is a hint only.
 */
export const LOOPBACK_PERMISSION_NAMES = ['loopback-network', 'local-network-access'] as const;

export type LoopbackPermissionName = (typeof LOOPBACK_PERMISSION_NAMES)[number];

/** A permission answer and where it came from. */
export interface LoopbackPermissionDetail {
  state: LoopbackPermission;
  /** The name that answered; `undefined` when no query was supported. */
  name: LoopbackPermissionName | undefined;
  /**
   * True only for an answer to `loopback-network`. An unverified answer (the legacy fallback) is
   * never proof of the loopback permission: detection does not stop on it, and does not report it
   * as the loopback state.
   */
  verified: boolean;
}

export function defaultPermissions(): PermissionsLike | undefined {
  const nav = (globalThis as { navigator?: { permissions?: PermissionsLike } }).navigator;
  return nav?.permissions;
}

function asState(state: string): LoopbackPermission {
  return state === 'granted' || state === 'denied' || state === 'prompt' ? state : 'unknown';
}

/** Queries the names in order; the first supported name answers. */
export async function queryLoopbackPermissionDetail(
  permissions: PermissionsLike | undefined = defaultPermissions(),
): Promise<LoopbackPermissionDetail> {
  if (permissions === undefined || typeof permissions.query !== 'function') {
    return { state: 'unknown', name: undefined, verified: false };
  }
  for (const name of LOOPBACK_PERMISSION_NAMES) {
    try {
      const status = await permissions.query({ name });
      return { state: asState(status.state), name, verified: name === 'loopback-network' };
    } catch {
      // Unsupported name in this browser: try the next one.
    }
  }
  return { state: 'unknown', name: undefined, verified: false };
}

/**
 * The raw answer of the first supported name, which may be the unverified legacy fallback.
 * Detection gates only on `queryLoopbackPermissionDetail(...).verified` answers.
 */
export async function queryLoopbackPermission(
  permissions: PermissionsLike | undefined = defaultPermissions(),
): Promise<LoopbackPermission> {
  return (await queryLoopbackPermissionDetail(permissions)).state;
}
