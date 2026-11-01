#!/usr/bin/env node
/*
 * T05 observable acceptance, as a script:
 *   1. every surface has a prototype file and a spec file with the expected section;
 *   2. the copy source covers every required detection state and error code, and docs/design/copy.md
 *      is in sync with it;
 *   3. axe-core (WCAG 2.0/2.1/2.2 A+AA plus best-practice) finds no violations in any prototype state,
 *      in the light and dark themes;
 *   4. token contrast pairs meet WCAG 2.2 AA (text 4.5:1, UI components and focus 3:1) in both themes.
 * Run through ./run.sh, which provides playwright and axe-core via NODE_PATH.
 * Flags: --only=<file.html>  scan one prototype;  --verbose  list every state visited.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { generate, currentBlock, load } = require("./copy-table.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const PROTO_DIR = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7);
const verbose = args.includes("--verbose");
let failures = 0;
const fail = (msg) => { failures++; console.log("  FAIL " + msg); };
const ok = (msg) => console.log("  ok   " + msg);

/* ---------- 1. Surfaces ---------- */
const SURFACES = [
  { name: "Scan dialog", proto: "scan-dialog.html", spec: "scan-dialog.md" },
  { name: "Detection dialogs", proto: "detection.html", spec: "detection-dialogs.md" },
  { name: "Tray / menu-bar agent", proto: "tray.html", spec: "tray-agent.md" },
  { name: "Design tokens", proto: "tokens.html", spec: "tokens.md" },
  { name: "Copy table", proto: "scan-dialog.html", spec: "copy.md" },
  { name: "Accessibility spec", proto: "index.html", spec: "accessibility.md" },
];
console.log("1. Surfaces");
for (const s of SURFACES) {
  const p = path.join(PROTO_DIR, s.proto), d = path.join(ROOT, "docs/design", s.spec);
  if (!fs.existsSync(p)) fail(`${s.name}: missing prototype ${s.proto}`);
  else if (!fs.existsSync(d)) fail(`${s.name}: missing spec docs/design/${s.spec}`);
  else ok(`${s.name}: ${s.proto} + docs/design/${s.spec}`);
}

/* ---------- 2. Copy coverage ---------- */
console.log("2. Copy table");
const { COPY, REQUIRED } = load();
for (const key of [...REQUIRED.detectionStates, ...REQUIRED.errorCodes]) {
  const c = COPY[key];
  if (!c) fail(`copy.js has no entry for ${key}`);
  else if (!c.title || !c.body) fail(`${key} needs a title and a body`);
}
for (const [k, c] of Object.entries(COPY)) {
  if (/not installed/i.test(c.title + " " + c.body)) fail(`${k} says "not installed" (forbidden by D-008)`);
}
// T10 hand-off: the 12 original codes are confirmed; the added codes have copy.
for (const key of REQUIRED.errorCodes) if (COPY[key] && COPY[key].t10 !== "confirmed") fail(`${key} must be t10: "confirmed"`);
for (const key of REQUIRED.addedCodes || []) {
  const c = COPY[key];
  if (!c) fail(`copy.js has no entry for T10-added code ${key}`);
  else if (c.kind !== "error" || c.t10 !== "added" || !c.title || !c.body) fail(`${key} must be kind error, t10 "added", with a title and body`);
}
// Revocation says "access revoked", never that pages were erased or are gone (T10 R-A12; masters' agreement).
const rv = COPY["token-revoked"];
if (rv && (!/revoked/i.test(rv.title + rv.body) || /eras|delet|gone|no longer available/i.test(rv.title + " " + rv.body))) fail("token-revoked must say access was revoked, not that pages were erased");
// OD-8: Safari is required; "unsupported" is never shipped copy.
for (const [k, c] of Object.entries(COPY)) if (/safari/i.test(c.title + c.body) && /unsupported|isn't supported|not supported/i.test(c.title + " " + c.body)) fail(`${k} calls Safari unsupported (OD-8)`);
ok(`T10 alignment: ${REQUIRED.errorCodes.length} codes confirmed, ${(REQUIRED.addedCodes || []).length} added-code entries, revocation and Safari wording`);
const block = currentBlock();
if (!block) fail("docs/design/copy.md has no generated copy-table block");
else if (block !== generate()) fail("docs/design/copy.md is out of date: run node design/prototypes/check/copy-table.cjs --write");
else ok(`copy.md in sync; ${REQUIRED.detectionStates.length} required states and ${REQUIRED.errorCodes.length} error codes covered (${Object.keys(COPY).length} keys total)`);
const md = fs.readFileSync(path.join(ROOT, "docs/design/copy.md"), "utf8");
for (const key of [...REQUIRED.detectionStates, ...REQUIRED.errorCodes, ...(REQUIRED.addedCodes || [])]) {
  if (!md.includes("`" + key + "`")) fail(`copy.md does not list ${key}`);
}

/* ---------- 3 + 4. Browser checks ---------- */
(async () => {
  let chromium, axeSource;
  try {
    chromium = require("playwright").chromium;
    axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  } catch (e) {
    fail("playwright/axe-core not found; run design/prototypes/check/run.sh");
    return finish();
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  const files = fs.readdirSync(PROTO_DIR).filter((f) => f.endsWith(".html") && (!only || f === only)).sort();
  console.log("3. axe scan (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice)");
  let visited = 0;
  for (const file of files) {
    const base = pathToFileURL(path.join(PROTO_DIR, file)).href;
    await page.goto(base);
    const combos = await page.evaluate(() => {
      const P = window.PROTO;
      if (!P) return [{}];
      if (typeof P.matrix === "function") return P.matrix();
      const ctl = P.controls || [];
      if (!ctl.length) return [{}];
      const [first, ...rest] = ctl;
      const out = first.options.map(([v]) => ({ [first.name]: v }));
      for (const c of rest) for (const [v] of c.options.slice(1)) out.push({ [c.name]: v });
      return out;
    });
    // Review r1 #5: every scan-banner code must be rendered (state=error&code=…), not just the default code.
    if (file === "scan-dialog.html") {
      const missing = REQUIRED.scanBannerCodes.filter((code) => !combos.some((c) => c.state === "error" && c.code === code));
      if (missing.length) fail(`scan-dialog.html matrix does not render error banners: ${missing.join(", ")}`);
      else ok(`scan-dialog.html renders all ${REQUIRED.scanBannerCodes.length} scan-banner error codes`);
    }
    let fileViolations = 0;
    for (const combo of combos) {
      for (const theme of ["light", "dark"]) {
        const q = new URLSearchParams({ ...combo, theme }).toString();
        pageErrors.length = 0;
        await page.goto(base + "?" + q);
        await page.waitForTimeout(120);
        await page.addScriptTag({ content: axeSource });
        const res = await page.evaluate(async () => {
          // Animations are paused at their end state so contrast is measured on the settled UI.
          document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { a.pause(); } });
          return await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
            resultTypes: ["violations"],
          });
        });
        visited++;
        if (verbose) console.log(`       ${file}?${q}: ${res.violations.length} violations`);
        for (const err of pageErrors) fail(`${file}?${q}: script error: ${err}`);
        for (const v of res.violations) {
          fileViolations++;
          fail(`${file}?${q}: [${v.impact}] ${v.id}: ${v.help}\n         ${v.nodes.slice(0, 3).map((n) => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\n").slice(1, 2).join("")).join("\n         ")}`);
        }
      }
    }
    if (!fileViolations) ok(`${file}: ${combos.length} states x 2 themes, no violations`);
  }
  console.log(`   (${visited} page states scanned)`);

  /* ---------- 4. Token contrast ---------- */
  if (!only || only === "tokens.html") {
    console.log("4. Token contrast (WCAG 2.2 AA)");
    const PAIRS = [
      ["--z-text", "--z-bg", 4.5], ["--z-text", "--z-surface-sunken", 4.5], ["--z-text-muted", "--z-bg", 4.5],
      ["--z-text-muted", "--z-surface-sunken", 4.5], ["--z-on-accent", "--z-accent", 4.5], ["--z-accent", "--z-bg", 4.5],
      ["--z-danger", "--z-danger-subtle", 4.5], ["--z-danger", "--z-bg", 4.5], ["--z-warning", "--z-warning-subtle", 4.5],
      ["--z-success", "--z-success-subtle", 4.5], ["--z-info", "--z-info-subtle", 4.5],
      ["--z-border-strong", "--z-bg", 3], ["--z-border-strong", "--z-surface-sunken", 3],
      ["--z-focus", "--z-bg", 3], ["--z-focus", "--z-surface-sunken", 3], ["--z-accent", "--z-surface-sunken", 3],
    ];
    for (const theme of ["light", "dark"]) {
      await page.goto(pathToFileURL(path.join(PROTO_DIR, "tokens.html")).href + "?theme=" + theme);
      const results = await page.evaluate((pairs) => {
        const root = document.querySelector(".zilo");
        const probe = document.createElement("span");
        root.appendChild(probe);
        const rgb = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
        const parse = (s) => {
          const m = s.match(/[\d.]+/g).map(Number);
          return s.startsWith("color(srgb") ? m.slice(0, 3).map((x) => x * 255) : m.slice(0, 3);
        };
        const lum = (c) => { const [r, g, b] = c.map((x) => x / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const out = pairs.map(([fg, bg, min]) => {
          const a = lum(parse(rgb(fg))), b = lum(parse(rgb(bg)));
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          return { fg, bg, min, ratio: Math.round(ratio * 100) / 100 };
        });
        probe.remove();
        return out;
      }, PAIRS);
      const bad = results.filter((r) => r.ratio < r.min);
      bad.forEach((r) => fail(`${theme}: ${r.fg} on ${r.bg} = ${r.ratio}:1 (needs ${r.min}:1)`));
      if (!bad.length) ok(`${theme}: ${results.length} pairs pass (lowest ${Math.min(...results.map((r) => r.ratio))}:1)`);
    }
  }
  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(2); });

function finish() {
  console.log(failures ? `\n${failures} failure(s)` : "\nAll T05 prototype checks passed");
  process.exit(failures ? 1 : 0);
}
