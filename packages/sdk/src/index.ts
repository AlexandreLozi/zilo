export { version } from './version.js';
export {
  ZiloClient,
  ZiloJobLostError,
  DEFAULT_PORTS,
  DEFAULT_PROBE_TIMEOUT_MS,
  detectSafari,
  type ZiloClientOptions,
  type TrackedJob,
  type JobsLostListener,
} from './client.js';
export {
  Detector,
  TRANSITIONS,
  canTransition,
  type DetectionStateName,
  type DetectionSnapshot,
  type DetectionListener,
  type AuthUnavailableCause,
  type DetectionDeps,
  type ProbeResult,
} from './detection.js';
export { AuthClient, isFinal } from './auth.js';
export {
  MemoryCredentialStore,
  type CredentialStore,
  type FamilyCredential,
  type OriginCredentials,
} from './credentials.js';
export {
  PROBLEM_CODES,
  isKnownProblemCode,
  isProblem,
  ZiloError,
  ZiloProblemError,
  ZiloTransportError,
  ZiloTimeoutError,
  ZiloAbortError,
  ZiloDisposedError,
  ZiloProtocolError,
  ZiloAgentRestartedError,
  ZiloAccessRevokedError,
  type ProblemCode,
} from './errors.js';
export {
  HttpTransport,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type FetchLike,
  type TransportOptions,
  type RequestOptions,
} from './transport.js';
export {
  queryLoopbackPermission,
  queryLoopbackPermissionDetail,
  LOOPBACK_PERMISSION_NAMES,
  type LoopbackPermission,
  type LoopbackPermissionDetail,
  type LoopbackPermissionName,
  type PermissionsLike,
} from './permission.js';
export {
  resolutionChoice,
  isResolutionList,
  isResolutionRange,
  type ResolutionChoice,
} from './decode.js';
export {
  SDK_PROTOCOL,
  REQUIRED_PUBLIC_CAPABILITIES,
  publicFit,
  compareSemver,
  type Fit,
} from './compat.js';
export { createLogger, redactValue, type DebugLogger, type LogFields } from './log.js';
export type * from './types.js';
export type { components, paths } from './generated/openapi.js';
