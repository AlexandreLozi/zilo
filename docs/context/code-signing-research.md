# Code signing for an indie open-source release: options (liaison research, 2026-11-01)

The owner wants signing to be free or as cheap as possible. Zilo is his personal open-source
project, he is in Brazil, and it ships through GitHub Releases, not the MS Store or Apple's App
Store. These findings feed D-011, SP-4b and M6/M7. Verify again before buying anything: the
programs change often.

## Windows
| Option | Cost | Fit for Zilo |
|---|---|---|
| **SignPath Foundation (free OSS program)** | Free | **Best fit at release.** The certificate is issued to SignPath Foundation, which then appears as the publisher, and it integrates with GitHub Actions. Requires an OSI-approved licence, a **public** repo, and reportedly an existing public release before applying. That conflicts with "private and no licence until M7", so it applies at M7. |
| Azure Artifact Signing (ex-Trusted Signing) | about US$9.99/month (third-party figure) | Individuals accepted **only in the US and Canada**; organizations only in the US, Canada, the EU and the UK. **Likely unavailable to the owner as an individual in Brazil.** |
| Commercial OV certificate (e.g. Certum, including its cheaper open-source offer) | about €49 to several hundred per year | A fallback if SignPath declines. Needs a hardware or cloud token. |
| Unsigned | Free | SmartScreen shows "More info → Run anyway". **Smart App Control blocks it outright, with no per-app exception.** Not acceptable for clinic users (D-011). |

Self-signed certificates don't satisfy Smart App Control or SmartScreen.

## macOS
- There is **no free route** to a binary that passes Gatekeeper. Developer ID signing and
  notarization need the Apple Developer Program (US$99/year).
- Unsigned builds still run if the user goes to System Settings → Privacy & Security → "Open
  Anyway", which is acceptable only for testers.
- **Homebrew** now requires official casks to pass Gatekeeper; failing casks have been disabled
  since about Sept 2026. A third-party tap is possible but still hits Gatekeeper.

## Linux
Free: GPG-signed `.deb`/`.rpm` repo or AppImage. No CA cost.

## Recommendation
- **Development and testers (now to M6):** unsigned or test-key builds. Testers get one-time
  instructions:
  - Windows: Smart App Control must be off or in evaluation mode on the test PC, or test in a VM.
  - macOS: "Open Anyway".
- **Public release (M7):** go public under the chosen licence, cut a first release, then apply to
  **SignPath Foundation** for free Windows signing. Linux is free.
- **macOS:** the US$99/year is the one unavoidable cost if Zilo should install without warnings.
  A company that uses Zilo instead of a Dynamsoft licence (for example the owner's employer)
  could reasonably sponsor it.
- Re-check Azure Artifact Signing eligibility for Brazil at M7; it may expand.

## Sources
- SignPath Foundation: https://signpath.org/ · conditions: https://signpath.org/terms · https://about.signpath.io/product/open-source
- Azure Artifact Signing eligibility (Microsoft Q&A): https://learn.microsoft.com/en-us/answers/questions/5810735/cant-create-a-new-trusted-signing-individual-ident · pricing: https://azure.microsoft.com/pricing/details/artifact-signing/
- Smart App Control has no per-app exception (community): https://techcommunity.microsoft.com/discussions/windows-security/windows-security-smart-control-is-blocking-my-cpp-and-exe-files-and-how-to-fix-t/4561964 · https://github.com/KnifeLemon/Filee/discussions/255
- Homebrew Gatekeeper requirement: https://github.com/orgs/Homebrew/discussions/7050 · https://github.com/Homebrew/brew/issues/20755 · https://workbrew.com/blog/homebrew-5-0-0
