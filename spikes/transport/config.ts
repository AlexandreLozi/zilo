// SP-1a spike configuration shared by the agent stub, the test-page server and the tests.
// Throwaway spike code: not a production package.

const env = (name: string, fallback: string): string => process.env[name] ?? fallback;

export const AGENT_PORT = Number(env('ZILO_AGENT_PORT', '47613'));
export const APP_HTTPS_PORT = Number(env('ZILO_APP_HTTPS_PORT', '8443'));
export const APP_HTTP_PORT = Number(env('ZILO_APP_HTTP_PORT', '8080'));

export const APP_HOST = 'app.zilo.test';
export const EVIL_HOST = 'evil.zilo.test';

/** The public app origin under test (HTTPS, non-loopback name). */
export const APP_ORIGIN = `https://${APP_HOST}:${APP_HTTPS_PORT}`;
/** A hostile HTTPS origin that serves the same page; the stub must deny it. */
export const EVIL_ORIGIN = `https://${EVIL_HOST}:${APP_HTTPS_PORT}`;
/** HTTP control origin. Allowlisted on purpose so a failure isolates browser policy from server policy. */
export const HTTP_CONTROL_ORIGIN = `http://${APP_HOST}:${APP_HTTP_PORT}`;
/** The S2 bridge origin (top-level popup on loopback). The port is part of the origin. */
export const BRIDGE_ORIGIN = `http://127.0.0.1:${AGENT_PORT}`;

export const ALLOWED_APP_ORIGINS = [APP_ORIGIN, HTTP_CONTROL_ORIGIN];

/**
 * Spike-only stand-in for a D-004 per-origin bearer token. Tests type it into the page;
 * it is never placed in a URL.
 */
export const APP_TOKENS: Record<string, string> = {
  [APP_ORIGIN]: env('ZILO_SPIKE_APP_TOKEN', 'spike-app-token-6b1f0f6e3c5d4a2e9b7c'),
  [HTTP_CONTROL_ORIGIN]: env('ZILO_SPIKE_HTTP_TOKEN', 'spike-http-token-0d9c8b7a6f5e4d3c2b1a'),
};

export const MAX_BLOB_BYTES = 16 * 1024 * 1024;
export const MAX_BRIDGE_BYTES = 8 * 1024 * 1024;
export const EVENT_TICKS = 5;
export const EVENT_INTERVAL_MS = 200;

export const SPIKE_DIR = new URL('.', import.meta.url).pathname;
export const CERT_DIR = `${SPIKE_DIR}.certs`;
export const ARTIFACT_DIR = `${SPIKE_DIR}artifacts`;
export const AUDIT_LOG = env('ZILO_AUDIT_LOG', `${ARTIFACT_DIR}/agent-audit.jsonl`);
