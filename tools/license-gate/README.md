# License metadata gate

Default-deny metadata enforcement for the jointly approved [D-002 licensing
guardrails](../../docs/planning/DECISIONS.md#d-002-licensing-guardrails).
This is policy enforcement, **not a legal judgment or release clearance**.

## CLI

From the repository root:

```sh
python3 tools/license-gate/gate.py check INVENTORY --policy POLICY
```

Stdout is a JSON object with keys `status`, `errors`, `packages`, and `payloads`.
Use the exit code for automation:

| Exit | Meaning |
| --- | --- |
| `0` | Passed the supplied metadata policy. |
| `1` | Denied by policy. |
| `2` | Malformed metadata, malformed JSON, or an I/O failure. |

Duplicate package identities or payload paths fail closed; do not depend on a
particular exit code for duplicates.

## Synthetic examples only

**Every fixture is fabricated.** Package names, hashes, provenance URLs, review
records, and obligations are test data, not observations of restored packages.
`example.invalid` URLs are deliberately non-resolving. No fixture grants legal
approval, and no real legal exception record is created by these examples.

```sh
# Expected exit 0: an exact permissive package pin and its managed payload.
python3 tools/license-gate/gate.py check tools/license-gate/fixtures/permissive-inventory.json --policy tools/license-gate/fixtures/permissive-policy.json

# Expected exit 1: a GPL package has a normal policy pin, but no exception.
python3 tools/license-gate/gate.py check tools/license-gate/fixtures/denied-inventory.json --policy tools/license-gate/fixtures/permissive-policy.json

# Expected exit 0: fabricated, exact package exception and native payload review.
# This demonstrates review metadata matching, NOT clearance for any SANE binary.
python3 tools/license-gate/gate.py check tools/license-gate/fixtures/reviewed-sane-inventory.json --policy tools/license-gate/fixtures/reviewed-sane-policy.json

# Expected exit 0: synthetic file evidence maps null raw metadata to conditional LGPL.
# Self-authored interpretation metadata is NOT independent review or legal clearance.
python3 tools/license-gate/gate.py check tools/license-gate/fixtures/file-mapped-lgpl-inventory.json --policy tools/license-gate/fixtures/file-mapped-lgpl-policy.json
```

The denied package's presence in `permissive-policy.json` is intentional: a
normal package pin alone does not authorize restricted licensing. The SANE
example's `docs/legal/exceptions.md#synthetic-example-sane-not-an-approval`
reference is a deliberately synthetic placeholder, not a real reviewed entry.
Never copy these fixtures into a production approval policy.

## Inventory contract

Inventory is a JSON object containing:

- `schemaVersion`: integer `1`.
- `rid`: the runtime identifier covered by this inventory.
- `packages`: a **nonempty** array of objects with `id`, `version`, `sha512`,
  `licenseExpression`, `licenseFile`, and `source`.
- `payloads`: an array of objects with `path`, `sha256`, `kind`, `packageId`,
  and `packageVersion`.

`sha512` is canonical NuGet-style base64 encoding of exactly 64 bytes, not a hex
digest or a `sha512-` prefixed value. `sha256` is exactly 64 lowercase hex
characters. Fixture hashes have valid encodings but do not identify real assets.
Both `licenseExpression` and `licenseFile` remain required fields, each accepting
a nonempty string or JSON `null`. Both null is denied. `source` remains a
nonempty provenance string. When the raw `licenseExpression` is null, a
non-null `licenseFile` and `licenseFileSha256` (64 lowercase hex characters)
are required for evidence mapping. `licenseFileSha256` is optional otherwise,
when an actual license file is known. The filename and source are provenance
strings; the gate does **not** check disk existence, read license bytes, or
fetch URLs. The producer must compute the actual license-file hash.

Payload paths are POSIX relative paths, without traversal. Package identities
and payload paths must not be duplicated. Kinds are `managed`, `native`, `data`,
`unowned`, and `application-code`. Owned payloads identify an inventory package
using `packageId` and `packageVersion`; `unowned` uses JSON `null` for both.

## Policy contract and matching

Policy is a JSON object with `schemaVersion: 1` and **all four required arrays**:

- `allowedExpressions`: safe permissive SPDX atoms chosen from `MIT`,
  `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`, `Zlib`, `BSL-1.0`,
  `Unlicense`, and `CC0-1.0`; conditional `LGPL-2.1-only` and
  `LGPL-2.1-or-later` may also be listed subject to the requirements below.
- `packages`: exact pins with `id`, `version`, `sha512`, `licenseExpression`
  (the effective reviewed SPDX expression, not null). Optional evidence fields
  are `licenseFile`, `licenseFileSha256`, `source`, `review`, `obligations`,
  and `provenance`; some approval paths require them as described below.
- `exceptions`: exact pins with the same four fields plus `review`,
  `obligations`, and `provenance`.
- `reviewedPayloads`: exact pins with `rid`, `path`, `sha256`, `kind`,
  `packageId`, `packageVersion`, `licenseExpression`, `review`, `obligations`,
  and `provenance`.

All arrays may be empty except inventory `packages`. A review contains nonempty
`reviewer`, a valid `date` in `YYYY-MM-DD` form, and a `reference`. Ordinary SPDX
interpretation evidence may reference `docs/spikes/SP-2a.md#license-evidence`;
restricted exceptions require `docs/legal/exceptions.md#anchor`. `obligations`
and `provenance` are nonempty arrays of nonempty strings. Review metadata is
required evidence structure, not proof of legal clearance or independent review.
The reviewer may explicitly identify a self-authored interpretation pending
Claude review; recording it does not mean that cross-model review passed.

Every package requires an exact normal `packages` pin. When the inventory's raw
expression is null, **all six evidence fields** on that pin are required:
`licenseFile`, `licenseFileSha256`, `source`, `review`, `obligations`, and
`provenance`. The policy filename, file hash, and source must equal the actual
inventory values. This binds an interpretation to exact package and license
evidence; it is not permission to infer a license from a filename alone.

A license not admitted by the permissive or conditional catalog and
`allowedExpressions` additionally requires an exact `exceptions` pin. True
restricted GPL/AGPL/Split licenses and compound SPDX expressions still require
version/hash-specific `docs/legal/exceptions.md#anchor` exceptions. There is no
permissive `OR` branch shortcut, and file mapping cannot launder a restricted
license into approval. A version/hash/license change requires a new matching
pin and, where applicable, a new exception. GPL with `SANE-exception` can be
specifically reviewed under D-002; GPL is not categorically prohibited for every
artifact.

Conditional `LGPL-2.1-only` and `LGPL-2.1-or-later` may pass without a restricted
exception when included in `allowedExpressions`, but their normal package pin
must carry `review`, `provenance`, and all four canonical obligations:
`license-text`, `notice`, `source-offer`, and `replaceable-dll`. A null raw
expression additionally requires the complete source-evidence mapping above.
Other LGPL expressions are not added to the conditional catalog by this rule.
LGPL still requires this inventory package `deployment` object:

```json
{
  "linkage": "dynamic",
  "separateDll": true,
  "replaceable": true,
  "trimmed": false,
  "merged": false,
  "singleFile": false
}
```

When an LGPL exception is required, its obligations must also include those
four canonical obligations. These and the deployment fields are declarations to
enforce; they do not demonstrate that the deployed DLL is actually replaceable.

Owned `managed` and `data` payloads depend on their package approval. `native`
and `unowned` payloads also require exact `reviewedPayloads` pins with complete
review, obligations, and provenance. A native payload's reviewed license
expression must equal its owner's **effective interpreted expression**, not
null raw metadata. Restricted unowned payloads are admitted only for the known
GPL-with-`SANE-exception` case with a reviewed reference, not arbitrary unowned
LGPL or other restricted material.

NAPS2 application code (`application-code` with a NAPS2 owner), Dynamsoft
artifacts, `NAPS2.Images.ImageSharp`, and `SixLabors.ImageSharp` (including its
extension packages) are always denied, even if an exception
is supplied. An exception cannot override these D-002 prohibitions.

## Design and trust boundary

The input producer must enumerate the **actual restored dependency graph and
actual published payloads for each RID**, compute real package/payload hashes,
and supply attributable license and ownership evidence. An inventory derived
only from direct project references is not sufficient. Treat both the producer
and approval policy as trusted, reviewed inputs; untrusted input can lie about
names, licenses, ownership, deployment flags, hashes, or omitted payloads.

This metadata tool does not attest bytes, license truth, legal correctness,
inventory completeness, or the final installer. It does not prove the absence
of Dynamsoft/NAPS2 application material hidden behind inaccurate metadata.
Matching a synthetic or real review-shaped record is not legal clearance.

Missing real restored-graph and per-RID payload evidence remains **blocked
pending review**, not passed by these examples. D-002 still requires actual
license texts, NOTICE/source-offer obligations, LGPL deployment checks, the
resolved permissive Fonts pin and compatibility tests, and legal review of the
final installer before the first external release.

## Verification notes

The standard-library test command is:

```sh
python3 -m unittest discover -s tools/license-gate -p 'test_*.py' -v
```

The example commands above document expected results, not validation evidence.
Validation of the integrated implementation belongs to the parent GPT
orchestrator/T02 integration owner; cross-model review of the combined diff is
separate. This docs/fixtures contribution does not claim that those checks ran.
