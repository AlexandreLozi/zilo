# T12 dependency approval and inventory

Both masters explicitly approved the exact managed `ZXing.Net [0.16.11]`
Apache-2.0 production QR dependency for Virtual and its tests, coordinator ask
reply referencing Opus `msg_9aee77237224`. No other new dependency is authorized.

Existing metadata/license provenance: `docs/spikes/SP-2a.md` and
`docs/reviews/T12-proto-r1.md` verified the exact package's Apache-2.0 identity.
This is not a waiver, installer inventory, or external release/legal clearance.
Extracted NuGet nuspec was read from the existing task-private cache:
`/tmp/opencode/t12-proto-r2/nuget/zxing.net/0.16.11/zxing.net.nuspec`.
It identifies `ZXing.Net`, version `0.16.11`, author Michael Jahn, expression
`Apache-2.0`, project `https://github.com/micjahn/ZXing.Net/`, and an empty net9.0
dependency group (the compatible managed asset selected by net10.0).

The final lock closure still must be checked after restore; any new transitive
image/native package blocks acceptance. Package-wide legacy native/WPF assets
are not permission to select or ship them; final project assets must select
only the managed net9.0 `zxing.dll`.

The runnable read-only `audit-dependencies.py` compares the union of exact
backend lock identities against frozen base `add1d73`, reads the cached nuspec,
hashes the actual nupkg and checks restored compile/runtime asset selection.
`dependency-audit.log` records exactly one newly resolved identity:
`ZXing.Net 0.16.11`; no transitive dependency and no native/runtime-target asset.
Selected compile/runtime asset is `lib/net9.0/zxing.dll` for net10.0.

Actual cached archive SHA-512 (base64, matching cache `.nupkg.sha512`):
`kHBBMH1ZKN4Y5IZY8Cq6iETXOr7k00ZrJ8Nbsow9QlTcJZvJVR26bX7VMR/oY1XOJuPzLyMu79WKdw+bKhechg==`.
NuGet `.nupkg.metadata` content identity (matching generated locks, distinct from
the signed cached archive hash):
`OZfAVu88hl87BffQ+rlWCj/vLvAhhCK4QnFaoveeF/MY8SjHNSYBQ3qyUEWlPKNgBQGh1syXhCDg10vUnCsqkg==`.

Required existing consumer lock updates are
`backend/src/Zilo.Agent/packages.lock.json` and
`backend/tests/Zilo.Scaffold.Tests/packages.lock.json`; preserve these transitive
QR entries when T11 rebases. No existing package-version upgrade is authorized.
