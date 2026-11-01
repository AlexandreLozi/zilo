# Questions for the owner

The owner checks these directly in the app repo that uses Dynamsoft and fills in the answers here,
or tells the liaison terminal. Masters: add new owner questions **here**, not in DISCUSSION.md.

## Answered
- **Safari on macOS:** **required for v1** (owner, 2026-10-31). The Safari path (T25-BE/FE, the S2
  bridge per T01) is release-blocking, not optional.
- **Front-end framework:** the owner left this to the agents. The decision is in OD-8.
- **CI hosting:** private GitHub repo, AlexandreLozi/zilo (OD-7).
- **Dynamsoft integration, Q1–Q13:** **answered 2026-11-01** from the app's code. The full call
  inventory is in **`docs/context/dwt-integration-inventory.md`** (T50 input). Headline facts:
  - dwt 19.4.2 from npm, React + Radix.
  - The built-in viewer plus a drag-reorder thumbnail strip.
  - GetDevicesAsync, SelectDeviceAsync and AcquireImageAsync (ADF on by default, optional
    duplex).
  - ConvertToBase64 to one multi-page PDF, posted to the app's own API.
  - No add-ons and no HTTPUpload.
  - No COOP/COEP; the CSP allows loopback.
  - X-Frame-Options SAMEORIGIN, so **no iframe**.
  - One known issue: the install dialog conflicts with the Radix modal.

## Open: customers and field data (needs product or support data, not code)
14. **Customers' environment.**
    - Which OS and browser mix do they use (rough %)?
    - Do users have **admin rights** to install software, or do we need a per-user install with
      no admin?
    - Are fleets managed (GPO/Intune/Jamf MDM)? If so, we can pre-approve the browser's
      local-access permission and push installs.
15. **Scanners in use.** Which models or brands are most common? Typical page volume per scan
    (1 page, 10 pages, 100+ ADF)? Duplex? This feeds the owner hardware checklist (T34).
16. **Pain points with Dynamsoft today.** Install failures, certificate or HTTPS problems, slow
    scans, browser breakages? These are the reliability targets Zilo should beat.

## Product and governance
- **Q17, ownership: answered 2026-11-01.** Zilo is the owner's **personal project**: Alexandre Lozi
  holds the copyright, and there is no employer sign-off. Copyright lines and any CLA or DCO name
  him.
- **Q18, licence: deferred by the owner.** It is not decided now. Bring it back **after a functional
  app is working and the owner has approved it**. It is a gate on the open-source release, on the
  roadmap as a later milestone, not current work.
  - At that point the masters bring a short comparison: MIT vs Apache-2.0 (patent grant) vs
    MPL/LGPL (copyleft), and what each means given NAPS2 is LGPL.
  - Until then, add no LICENSE file and keep the repo private.
