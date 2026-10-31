// Compile-only smoke test for the generated contract types (run by api/tools/check.sh).
// It is copied into a scratch directory outside the repo next to the generated `zilo-api.ts`.
import type { components, paths } from "./zilo-api";

type S = components["schemas"];

const KNOWN_EVENT_TYPES: readonly S["EventTypeKnown"][] = ["state", "progress", "page", "error", "done"];

function isKnownEventType(t: S["JobEventEnvelope"]["type"]): t is S["EventTypeKnown"] {
  return (KNOWN_EVENT_TYPES as readonly string[]).includes(t);
}

// R-V4 / R-E2 two-step decoding: every frame is an envelope; only known types are decoded further.
// The caller records envelope.seq as processed in both branches.
export function describeFrame(envelope: S["JobEventEnvelope"]): string {
  if (!isKnownEventType(envelope.type)) return `ignored ${envelope.seq}`;
  return describeEvent(envelope as S["JobEvent"]);
}

export function describeEvent(e: S["JobEvent"]): string {
  switch (e.type) {
    case "state":
      return `state ${e.state}`;
    case "progress":
      return `progress ${e.pagesCompleted}`;
    case "page":
      return `page ${e.page.index} ${e.page.side}`;
    case "error":
      return `error ${e.problem.code} ${e.problem.errorId} fatal=${String(e.fatal)}`;
    case "done":
      return `done ${e.state} ${e.pageCount}`;
  }
}

// Open response enums accept unknown values; request enums stay closed.
export const futureDriver: S["Driver"] = "future-driver";
export const futureState: S["JobState"] = "archived";
export const createJob: S["CreateJobRequest"] = {
  deviceId: "virtual-0",
  settings: { source: "duplex", resolution: 300, colorMode: "color", pageSize: "a4" },
};
export const badCreateJob: S["CreateJobRequest"] = {
  deviceId: "virtual-0",
  // @ts-expect-error request enums are closed (R-V5)
  settings: { source: "future-source" },
};

export const exportRequest: S["ExportRequest"] = {
  format: "pdf",
  pages: [
    { index: 2, rotate: 90 },
    { index: 0, rotate: 0 },
  ],
  quality: 80,
};

export function isRetryable(p: S["Problem"]): boolean {
  return p.retryable && p.code !== "token-revoked";
}

type HelloOk =
  paths["/zilo/v1/hello"]["get"]["responses"][200]["content"]["application/json"];
export const hello: HelloOk = {
  product: "zilo",
  scope: "public",
  protocol: { min: "1.0", max: "1.0" },
  capabilities: ["auth.consent", "auth.token", "transport.http"],
};
export function agentVersion(h: HelloOk): string | undefined {
  // Narrowing on the closed `scope` discriminator gives the required full-only fields.
  return h.scope === "full" ? `${h.version} ${h.os} ${h.arch} ${h.limits.maxPagesPerJob}` : undefined;
}

export const consent: S["ConsentStatus"] = {
  origin: "https://app.example.com",
  state: "pending",
  pollAfterSeconds: 2,
  promptExpiresAt: "2026-10-31T00:02:00Z",
};

export function familyOf(t: S["Token"]): string {
  return `${t.familyId} until ${t.familyExpiresAt}, renew after ${t.renewAfter}`;
}
