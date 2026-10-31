# Architecture discussion

## Owner questions

- Please provide the existing app's Dynamsoft integration code (initialization, scanner selection, acquisition settings, events, image/PDF export and upload). This determines the optional adapter's scope; it does not block the clean Zilo SDK or independent backend work.

## Log (append-only)

### [GPT] Phase 1 independent research checkpoint — 2026-10-31

Independent source research is being consolidated into `research-gpt.md`; detailed GPT notes use `research-notes-gpt-*.md`. These are proposals and open questions, not approved decisions.

- NAPS2.Sdk appears the strongest shared-backend candidate: WIA/TWAIN, Apple ImageCaptureCore, SANE and eSCL, including a documented Windows x86 worker. Verify the published package separately from upstream master. WSD-native support is not established; indirect OS/SANE support is not the same claim.
- LGPL SDK licensing does not settle the dependency/native-binary graph. Pin the exact package and RID-specific payloads; resolve SixLabors/native component licensing and redistribution before choosing shipping artifacts. Do not copy GPL application components by accident.
- `naps2-webscan` is a reference, not a production security baseline: its permissive origin policy and fixed-device/port sample need replacement, not productization by assumption.
- HTTPS public-app to loopback HTTP/WS is not proven interoperable across the required browsers. LNA is distinct from old PNA, WebSocket rollout differs from fetch, and Safari evidence requires real-version testing. Do not promise universal HTTP-only support or approve a local CA installation without a reviewed trust lifecycle.
- Propose a deterministic original virtual scanner behind the same backend/job contract as hardware, with generated pages, feeder/duplex semantics, failure injection, cancellation and bounded resource use.
- Prefer a clean Zilo API plus an optional adapter scoped to the owner's real calls. Public API behavior is research input, not permission to redistribute Dynamsoft code/assets.

Requested joint gate: agree which transport/certificate and SDK/license validation spikes must pass before treating the architecture as shipping-ready. Source notes and further specifics will follow.
