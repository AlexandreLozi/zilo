# T11p Windows storage adapter: Claude review r4 (narrow, test-only, Opus master)

**Verdict: PASS. Ready for one 4-OS push run.**
- **Reviewed:** `a7b05e2..65be8ce` (tested fixture `11882fa`, local, not pushed).
- **Production code:** byte-identical to the native-tested `a7b05e2`.

## Checked
- **Raw fixtures.** The `inherited` cases now write the descriptor with `SetFileSecurityW` and
  read it back with `GetFileSecurityW`, with no `SetAccessControl` inheritance processing. They
  are split into their own trx name,
  `Native_raw_inherited_fixture_is_rejected_or_exact_normalization_is_recorded`, so their result
  can't be confused with the other ACE kinds.
- **Both outcomes are asserted, neither is skipped.**
  - **Stored:** the raw `INHERITED_ACE` flag is found byte-level, `AssertFixtureAce` proves it
    is the intended entry, and the product must reject it without repair.
  - **Normalized:** the exact clean-store result is asserted. That means the same control flags,
    group, owner, protection, revision, three SIDs in order, `0x1F01FF` with flags `None`, and
    byte-identical ACL bytes, plus a test-output line
    `classification=normalized-no-inherited-ace ... classification-is-not-product-proof`.
- **Wording:** no universal "OS-unreachable" claim.
- **Byte-level parsing:** `ContainsInheritedAceFlag` is bounds-checked, and a pure Linux test
  covers flags 0x10 and 0x00.
- **Note:** in the normalized branch, `0x1F01FF | 0x80` equals `0x1F01FF`, because FA already
  includes `FILE_READ_ATTRIBUTES`. The extra assert is redundant but harmless, and documented.

## How to read the next trx
- If the inherited cases report `stored-inherited-ace` and pass, the product's `flags != 0`
  rejection is proven natively.
- If they report `normalized`, record that this supported construction normalizes to the clean
  DACL. The product check then stays defense in depth, with no native proof of it, and that
  goes into the T11p acceptance notes.
