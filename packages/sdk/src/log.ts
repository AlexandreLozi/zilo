// Redacted debug logging (CONTRACT.md R-V4, PLAN §4): only safe metadata (operation names, status,
// problem codes, type and field names, timings). Never tokens, request or response bodies, unknown
// payloads, document content, URLs with IDs, or headers.

/** Safe scalar metadata. Strings are bounded and checked against credential-like shapes. */
export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

/** A debug sink, for example `(event, fields) => console.debug('[zilo]', event, fields)`. */
export type DebugLogger = (event: string, fields: LogFields) => void;

const MAX_STRING = 64;
// Bearer-like secrets: long runs of base64url characters (tokens are >= 43 characters, R-A8).
const SECRET_LIKE = /[A-Za-z0-9_-]{32,}/;

/** Redacts a single field value: long or secret-like strings never reach the sink. */
export function redactValue(
  value: string | number | boolean | undefined,
): string | number | boolean | undefined {
  if (typeof value !== 'string') return value;
  if (SECRET_LIKE.test(value)) return '[redacted]';
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
}

/** Wraps a sink so every field passes `redactValue`, and a throwing sink never breaks the SDK. */
export function createLogger(sink: DebugLogger | undefined): DebugLogger {
  if (sink === undefined) return () => undefined;
  return (event, fields) => {
    const safe: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(fields)) safe[key] = redactValue(value);
    try {
      sink(event, safe);
    } catch {
      // Logging must never change SDK behaviour.
    }
  };
}
