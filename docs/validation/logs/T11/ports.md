# T11 loopback port handoff

- Fixed: **47841**; ordered fallbacks: **47842**, **47843** (TCP).
- Registry checked 2026-11-02: https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.csv
- All three are in the registry's `47810-47999` **Unassigned** range.
- This is not an IANA reservation, nor a guarantee that another local application is absent.
- Bind only `127.0.0.1`; try the tuple in order, never wildcard or arbitrary ports.
- SDK probes `http://127.0.0.1:<port>/zilo/v1/hello` in that order and verifies `product: zilo`.
- All occupied means fail startup, not broaden the listener.
