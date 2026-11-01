# Prototype checks (T05)

`./run.sh` runs the T05 observable acceptance locally:

1. Each surface has a prototype and a spec in `docs/design/`.
2. `assets/copy.js` covers every required detection state and error code, no string says "not installed", and
   `docs/design/copy.md` matches `node copy-table.cjs` output (regenerate it with `--write`).
3. axe-core 4.14 (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`) reports no violations for
   each prototype state (`window.PROTO.matrix()`, or every control option) in the light and dark themes. Animations are
   finished before each scan.
4. The token contrast pairs meet WCAG 2.2 AA in both themes.

The first run installs `playwright@1.64.1` and `axe-core@4.14.0` into `check/.deps/` (gitignored), plus Chromium if it
is missing. It is deliberately **not** part of any CI workflow, and the repo's pnpm workspace does not see it.

Flags: `--only=scan-dialog.html` scans one prototype; `--verbose` lists each state.

Known axe "incomplete" results (not violations): `<select>` elements and the tray mock's desktop bar have gradient
backgrounds, so axe cannot compute their contrast. The select text uses `--z-text` on `--z-bg`, which is covered by
check 4.
