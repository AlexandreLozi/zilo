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

## Open: product and governance
17. **Open-source ownership.** Is Zilo yours personally or your employer's? Does publishing it
    need sign-off? This decides who holds the copyright line and the CLA/DCO choice before the
    first public release.
18. **Licence preference** for the open-source release: permissive (MIT/Apache-2.0) or
    copyleft (LGPL/MPL)? The masters will propose one (OD-9). NAPS2 is LGPL, which works with
    either.
