// Compile-only smoke test for the generated contract types (run by api/tools/check.sh).
// It is copied into a scratch directory outside the repo next to the generated `zilo-api.ts`.
import type { components, paths } from "./zilo-api";

type S = components["schemas"];

export function describeEvent(e: S["JobEvent"]): string {
  switch (e.type) {
    case "state":
      return `state ${e.state}`;
    case "progress":
      return `progress ${e.pagesCompleted}`;
    case "page":
      return `page ${e.page.index} ${e.page.side}`;
    case "error":
      return `error ${e.problem.code} fatal=${String(e.fatal)}`;
    case "done":
      return `done ${e.state} ${e.pageCount}`;
    default:
      return "ignored";
  }
}

export const exportRequest: S["ExportRequest"] = {
  format: "pdf",
  pages: [
    { index: 2, rotate: 90 },
    { index: 0, rotate: 0 },
  ],
  quality: 80,
  deleteAfterExport: false,
};

export const createJob: S["CreateJobRequest"] = {
  deviceId: "virtual-0",
  settings: { source: "duplex", resolution: 300, colorMode: "color", pageSize: "a4" },
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
  capabilities: ["auth.consent", "auth.token"],
};

export const consent: S["ConsentStatus"] = { origin: "https://app.example.com", state: "pending" };
