# T05 review r1 (GPT reviewer, cross-model)

**Target:** branch `t05-design-spec` at author head `d667952`. The diff is `main...d667952`.

**Read first:**
- `docs/tasks/T05.md` (spec and acceptance);
- `docs/context/BRIEF.md`;
- DECISIONS D-003, D-004, D-004a (proposed), D-008 and D-011;
- the T10 draft contract's error codes and hand-offs: `git show t10-contract:api/CONTRACT.md`, the
  section "Hand-offs and open items".

**Check:**
1. **Scope:** only `docs/design/**` and `design/prototypes/**` changed. Nothing in `packages/`,
   `apps/` or any config.
2. **Coverage:** every surface in the T05 spec has a spec section and a static prototype that opens
   from `file://`.
3. **Detection states versus D-008:**
   - the copy never claims "not installed"; the `unreachable-or-blocked` wording is honest;
   - polling is described as bounded to the open dialog;
   - the per-browser permission help matches what SP-1a observed (Chrome "Apps on device", Firefox
     "Device apps and services").
4. **Security UX:**
   - the consent prompt shows the exact origin and resists spoofing (long, IDN and look-alike
     origins);
   - revocation is reachable;
   - nothing in the UI suggests disabling SmartScreen or SAC, or weakening browser security.
5. **Copy:**
   - the copy table covers the 12 T05 codes;
   - list the new T10 codes it still lacks (`consent-denied` blocked variant, `rate-limited`,
     `invalid-settings`, `unsupported-capability`, `not-found`, `agent-unavailable`) as findings for
     the fix round.
6. **Accessibility:** run the author's `design/prototypes/check/run.sh` headless and confirm 0 axe
   violations, contrast AA in both themes, and a focus order and live region for progress.
7. **No Dynamsoft look, assets or trademarks.** No external assets apart from system fonts.

**Allowed writes:** only `docs/reviews/T05-r1.md`. Do not fix anything. Headless only. No native
Windows runs (OD-6).

**Output:** a verdict of `pass` or `changes` with numbered findings (severity, file:line, evidence),
then `worker_done`.
