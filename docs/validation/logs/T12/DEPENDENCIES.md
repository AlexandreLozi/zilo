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
