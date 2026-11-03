# Manual ARM runner override — GPT r2

**PASS**, local artifact `a69a535` on `ci-backend-arm-dispatch`, based on `38a859b`.
This is a workflow review, not native ARM evidence or authorization to run CI.

The r1 runner-input concern is closed: the matrix selects literal runner arrays only. Input
text enters PowerShell through an environment variable, not source interpolation; the pre-test
guard rejects unsupported labels. Empty input intentionally defaults to `macos-latest`, as the
committed truth table documents (the author's completion summary incorrectly grouped it with
rejected inputs). Neither invalid nor JSON-shaped input can select an arbitrary runner.

Push/PR retain the four-OS matrix; valid manual dispatch selects one permitted Mac label.
Permissions, existing tests, timeouts and fail-fast behavior remain unchanged. The manual step
checks ARM64 and records image, checkout and lock-file evidence without claiming native success.

Reviewed the exact workflow diff and evidence log; independently checked 15 matrix cases and
`git diff --check`. Reused the author's local YAML/format check. Actionlint is unavailable;
no hosted workflow result is claimed. Backend source and lock changes are absent from this artifact.

Preserve locally. If the existing exact-source ARM retry supplies the required native evidence,
this override is optional and need not be pushed or included in the Windows validation batch.
