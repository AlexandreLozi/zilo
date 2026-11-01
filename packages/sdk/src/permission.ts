// Browser loopback permission (D-008 step 1). The Permissions API name is not available in every
// browser; where the query is missing or throws, the state is `unknown` and detection continues.

export type LoopbackPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** The part of `navigator.permissions` the SDK uses; injectable for tests. */
export interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ state: string }>;
}

/**
 * Permission names, most specific first. `loopback-network` is the D-008 name;
 * `local-network-access` is the older Chromium name for the same prompt.
 */
export const LOOPBACK_PERMISSION_NAMES = ['loopback-network', 'local-network-access'] as const;

export function defaultPermissions(): PermissionsLike | undefined {
  const nav = (globalThis as { navigator?: { permissions?: PermissionsLike } }).navigator;
  return nav?.permissions;
}

export async function queryLoopbackPermission(
  permissions: PermissionsLike | undefined = defaultPermissions(),
): Promise<LoopbackPermission> {
  if (permissions === undefined || typeof permissions.query !== 'function') return 'unknown';
  for (const name of LOOPBACK_PERMISSION_NAMES) {
    try {
      const status = await permissions.query({ name });
      if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
        return status.state;
      }
      return 'unknown';
    } catch {
      // Unsupported name in this browser: try the next one.
    }
  }
  return 'unknown';
}
