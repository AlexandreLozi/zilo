# T01 review r1 (GPT reviewer, cross-model, effort high)

**Target:** branch `t01-transport-spike` at author head `b4e14e1`. The diff is
`main...b4e14e1`. It includes the interim note `8cbc264:docs/spikes/SP-1a-interim.md`, but that note
is reviewed jointly with T10 in the BE Run, so you need only cross-check that it is consistent with
the final `SP-1a.md`.

**Read first:**
- `docs/tasks/T01.md` (spec and acceptance);
- DECISIONS D-003 (including the S2 mandatory properties), D-004, D-004a (proposed) and D-010/D-010a;
- `docs/planning/OWNER-DIRECTIVES.md` (OD-4 headless, OD-6 no native Windows runs);
- `docs/planning/research-notes-gpt-browser.md`.

**Check:**
1. **Scope:** only the allowed files changed.
2. **Methodology:**
   - The test page really is on a non-loopback, public-address-space HTTPS origin.
   - Negative controls exist and assert the right thing (hostile origin, bad Host, HTTP page).
   - Expected failures are asserted, not skipped.
3. **Re-run the Linux suite headless.** Get the browsers with `npx playwright install` into a scratch
   dir. WebKit may need scratch libraries (see the author's notes). Compare your results with the
   author's matrix and record any differences.
   - **Do NOT run anything natively on Windows (OD-6).** The Windows WebKit rows were observed before
     OD-6; check only that they are labelled honestly.
4. **S2 bridge prototype, against every D-003 S2 mandatory property:**
   - exact `event.source` and origin checks, nonce and fresh session;
   - typed operations only, with bounded binary transfer;
   - CSP and no framing; COOP handling;
   - no tokens in URLs;
   - consent bound to the opener origin.

   Is the recommendation "S2 for Safari" justified by the evidence? What is still unproven without
   real Safari?
5. **`SP-1a.md`:** does the matrix match the logs? Are pending rows honest? Does the manual
   real-Safari script look executable by the owner?
6. **Security:** the stub's Host/Origin/bearer checks, and any secret or key committed (there should
   be none; the per-run CA must be generated at runtime).

**Allowed writes:** only `docs/reviews/T01-r1.md`, plus new failing tests that demonstrate a defect.
Do not fix code.

**Output:** a verdict of `pass` or `changes`, with numbered findings (severity, file:line, evidence),
then `worker_done`.
