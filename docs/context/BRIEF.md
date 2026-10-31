# Zilo — project brief (from the owner, Alexandre)

## Goal
Build **Zilo**, a scanning bridge ("driver" in the owner's words) that fully replaces the
**Dynamsoft Dynamic Web TWAIN** service + JS SDK in the owner's web app, so the company stops
paying Dynamsoft licensing. It must support all kinds of scanners, in any browser, on any machine:
**Windows, macOS and Linux**. Whether each platform is native or shared/cross-platform code is
for the agents to decide from research: native where it materially matters, shared where native
would make marginal or no difference.

## Current app flow that Zilo must support (parity requirements)
1. User clicks **Scan** in the web app.
2. The app looks for the local scanning service (today: the Dynamsoft service).
3. **If it is not installed or running**, the app shows a **download dialog** (today it offers the
   Web TWAIN installer). The user downloads and installs it. Zilo needs its own installers per OS
   and a detect/download flow in the JS SDK.
4. Once installed, the **Scan dialog** lists available scanners: local USB/TWAIN/WIA/ICA/SANE
   devices and network scanners (eSCL/AirScan, WSD where feasible), as far as the browser allows.
5. It must also list a **virtual "fake scanner"** (Dynamsoft ships one) that "scans" a test page.
   Zilo must ship an equivalent virtual test scanner, which is also useful for CI and E2E tests.
6. The user scans: DPI, color mode, paper size, flatbed/ADF, duplex, multi-page. The result goes
   back to the web app as images or PDF.

## Integration with the existing app
The owner believes the app calls the Dynamsoft SDK and service via its JS API, but is not sure.
**The owner can provide the app's integration code on request.** If knowing the exact Dynamsoft
API surface the app uses would change a decision (for example, building a drop-in-compatible shim
versus a new API plus an app-side migration), ask the owner in your final status rather than
guessing. Until then, design a clean Zilo JS SDK and plan an optional thin compatibility adapter
for the Dynamsoft calls that are commonly used.

## Prior research
- `docs/context/chatgpt-conversation.md` is the owner's earlier ChatGPT chat. It recommends a
  NAPS2.Sdk-based (.NET, LGPL) local HTTP service on 127.0.0.1, with cyanfish/naps2-webscan
  (eSCL-based) as a reference, plus a React/TS SDK, and it flags licensing, browser Private
  Network Access / Local Network Access, and the TWAIN 32-bit worker issue.
- `docs/context/chatgpt-research-sources.txt` holds raw source snippets (NAPS2, SANE, WIA, TWAIN,
  Dynamsoft docs, RSWebTwain, etc.).
These are a starting point, not decisions. Verify them.

## Working model (set by the owner, non-negotiable)
- Two **master agents** lead: **Claude Opus 5.5** and **GPT Sol 6.1 (opencode)**. Every decision
  needs the **approval of both**. Record each one in `docs/planning/DECISIONS.md` with both
  approvals.
- Phases: **1. Plan → 2. Execution strategy → 3. Execution → 4. Validation.**
- In execution, the masters spawn worker agents. **GPT orchestrates the back-end agents. Opus owns
  design and front end.** **The Opus master is the overall execution orchestrator.**
- **Cross-model validation is mandatory:** Claude-written work is validated or reviewed by a GPT
  agent, and GPT-written work by a Claude agent. No agent validates its own model's work.
- Fully autonomous: agents run without permission prompts and do not wait on the owner, except to
  request the app integration code mentioned above, and even then they keep going on the parts
  that do not depend on it.
