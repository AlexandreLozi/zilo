"""Subprocess contract tests: no gate internals or external dependencies."""
import base64
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


GATE = Path(__file__).with_name("gate.py")
HASH = base64.b64encode(bytes(range(64))).decode("ascii")
OTHER_HASH = base64.b64encode(b"x" * 64).decode("ascii")
REVIEW = {"reviewer": "Legal reviewer", "date": "2026-10-31",
          "reference": "docs/legal/exceptions.md#review-1"}
EVIDENCE_REFERENCE = "docs/spikes/SP-2a.md#license-evidence"
DEPLOYMENT = {"linkage": "dynamic", "separateDll": True, "replaceable": True,
              "trimmed": False, "merged": False, "singleFile": False}
OBLIGATIONS = ["license-text", "notice", "source-offer", "replaceable-dll"]


class GateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="license-gate-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.inventory = {"schemaVersion": 1, "rid": "linux-x64", "packages": [{
            "id": "Example.Core", "version": "1.0.0", "sha512": HASH,
            "licenseExpression": "MIT", "licenseFile": "licenses/MIT.txt",
            "source": "https://api.nuget.org/v3/index.json"}], "payloads": [{
                "path": "lib/Example.dll", "sha256": "a" * 64, "kind": "managed",
                "packageId": "Example.Core", "packageVersion": "1.0.0"}]}
        self.policy = {"schemaVersion": 1, "allowedExpressions": ["MIT", "Apache-2.0"],
                       "packages": [self.pin()], "exceptions": [], "reviewedPayloads": []}

    def pin(self):
        return {k: self.inventory["packages"][0][k]
                for k in ("id", "version", "sha512", "licenseExpression")}

    def expression(self, expression):
        self.inventory["packages"][0]["licenseExpression"] = expression
        self.policy["packages"] = [self.pin()]

    def exception(self):
        self.policy["exceptions"] = [dict(self.pin(), review=copy.deepcopy(REVIEW),
            obligations=OBLIGATIONS[:], provenance=["Reviewed upstream license text"])]

    def native_review(self):
        payload = self.inventory["payloads"][0]
        self.policy["reviewedPayloads"] = [dict(payload, rid=self.inventory["rid"],
            licenseExpression=self.inventory["packages"][0]["licenseExpression"],
            review=copy.deepcopy(REVIEW), obligations=["license-text"],
            provenance=["Reviewed native upstream archive"])]

    def package_evidence(self):
        pin = self.policy["packages"][0]
        pin.update(review=dict(REVIEW, reference=EVIDENCE_REFERENCE),
                   obligations=OBLIGATIONS[:], provenance=["Self-authored interpretation pending review"])

    def file_mapping(self, expression="MIT"):
        self.expression(expression)
        self.inventory["packages"][0].update(licenseExpression=None, licenseFileSha256="c" * 64)
        pin = self.policy["packages"][0]
        for key in ["licenseFile", "licenseFileSha256", "source"]:
            pin[key] = self.inventory["packages"][0][key]
        self.package_evidence()

    def invoke(self, inventory=None, policy=None, code=0):
        inv_path, pol_path = self.root / "inventory.json", self.root / "policy.json"
        inv_path.write_text(json.dumps(self.inventory) if inventory is None else inventory)
        pol_path.write_text(json.dumps(self.policy) if policy is None else policy)
        run = subprocess.run([sys.executable, str(GATE), "check", str(inv_path),
                              "--policy", str(pol_path)], capture_output=True, text=True)
        self.assertEqual(run.returncode, code, (run.stdout, run.stderr))
        self.assertEqual(run.stderr, "")
        result = json.loads(run.stdout)
        self.assertEqual(set(result), {"status", "errors", "packages", "payloads"})
        self.assertEqual(result["status"], {0: "passed", 1: "denied", 2: "invalid"}[code])
        self.assertIsInstance(result["errors"], list)
        if code:
            self.assertTrue(result["errors"])
        else:
            self.assertEqual(result["errors"], [])
            self.assertEqual(result["packages"], len(self.inventory["packages"]))
            self.assertEqual(result["payloads"], len(self.inventory["payloads"]))
        return result

    def test_permissive_exact_pin_passes(self):
        self.invoke()

    def test_nuget_id_case_insensitive(self):
        self.policy["packages"][0]["id"] = "EXAMPLE.CORE"
        self.inventory["payloads"][0]["packageId"] = "example.core"
        self.invoke()

    def test_missing_pin_or_exact_pin_drift_denied(self):
        for field, value in [("version", "1.0.0.0"), ("sha512", OTHER_HASH),
                             ("licenseExpression", "Apache-2.0"), ("id", "Other")]:
            with self.subTest(field=field):
                self.policy["packages"] = [dict(self.pin(), **{field: value})]
                self.invoke(code=1)
        self.policy["packages"] = []
        self.invoke(code=1)

    def test_restricted_and_unknown_default_denied(self):
        for expr in ["GPL-3.0-only", "AGPL-3.0-or-later", "LGPL-2.1-or-later",
                     "LicenseRef-Six-Labors-Split-License", "Some-New-License"]:
            with self.subTest(expression=expr):
                self.expression(expr)
                self.invoke(code=1)

    def test_reviewed_gpl_agpl_split_packages_allowed(self):
        for expr in ["GPL-3.0-only", "AGPL-3.0-or-later", "LicenseRef-Six-Labors-Split-License"]:
            with self.subTest(expression=expr):
                self.expression(expr)
                self.exception()
                self.invoke()

    def test_unknown_cannot_be_cleared_by_exception(self):
        self.expression("LicenseRef-Made-Up")
        self.exception()
        self.invoke(code=1)

    def test_sane_exception_exact_compound_allowed(self):
        self.expression("GPL-2.0-or-later WITH SANE-exception")
        self.exception()
        self.invoke()

    def test_compounds_require_exact_review_no_or_shortcut(self):
        for expr in ["MIT OR GPL-3.0-only", "MIT AND Apache-2.0", "(MIT OR Apache-2.0) AND BSD-3-Clause"]:
            with self.subTest(expression=expr):
                self.expression(expr)
                self.policy["exceptions"] = []
                self.invoke(code=1)
                self.exception()
                self.invoke()
                self.policy["exceptions"][0]["licenseExpression"] = "MIT"
                self.invoke(code=1)

    def test_invalid_or_unknown_expression_never_approved(self):
        for expr in ["mit", "MIT OR", "MIT GPL-2.0-only", "()", "MIT WITH SANE-exception",
                     "GPL-2.0-only WITH Made-Up", "MIT OR LicenseRef-Invented", "MIT and Apache-2.0"]:
            with self.subTest(expression=expr):
                self.expression(expr)
                self.exception()
                self.invoke(code=1)

    def test_policy_cannot_expand_permissive_allowlist(self):
        for expr in ["GPL-3.0-only", "MIT OR GPL-3.0-only", "New-License", "mit"]:
            with self.subTest(expression=expr):
                self.policy["allowedExpressions"] = [expr]
                self.invoke(code=2)

    def test_empty_allowlist_is_default_deny(self):
        self.policy["allowedExpressions"] = []
        self.invoke(code=1)

    def test_exception_incomplete_review_rejected(self):
        self.expression("GPL-2.0-only WITH SANE-exception")
        self.exception()
        complete = copy.deepcopy(self.policy["exceptions"][0])
        for field in ["review", "obligations", "provenance"]:
            with self.subTest(field=field):
                self.policy["exceptions"] = [copy.deepcopy(complete)]
                del self.policy["exceptions"][0][field]
                self.invoke(code=2)
        for field, values in {"reviewer": ["", "unknown"], "date": ["2026-02-30", "2026-1-01"],
                              "reference": ["docs/legal/exceptions.md#", "other.md#yes"]}.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    self.policy["exceptions"] = [copy.deepcopy(complete)]
                    self.policy["exceptions"][0]["review"][field] = value
                    self.invoke(code=2)
        for field in ["obligations", "provenance"]:
            for value in [[], [""], ["unknown"], "text"]:
                self.policy["exceptions"] = [copy.deepcopy(complete)]
                self.policy["exceptions"][0][field] = value
                self.invoke(code=2)

    def test_lgpl_requires_complete_deployment_and_obligations(self):
        self.expression("LGPL-2.1-or-later")
        self.exception()
        self.invoke(code=1)
        self.inventory["packages"][0]["deployment"] = copy.deepcopy(DEPLOYMENT)
        self.invoke()
        for field, value in [("linkage", "static"), ("separateDll", False), ("replaceable", False),
                             ("trimmed", True), ("merged", True), ("singleFile", True)]:
            with self.subTest(field=field):
                self.inventory["packages"][0]["deployment"] = dict(DEPLOYMENT, **{field: value})
                self.invoke(code=1)
        self.inventory["packages"][0]["deployment"] = copy.deepcopy(DEPLOYMENT)
        for obligation in OBLIGATIONS:
            self.policy["exceptions"][0]["obligations"] = [x for x in OBLIGATIONS if x != obligation]
            self.invoke(code=1)

    def test_lgpl_in_compound_cannot_hide_deployment_rule(self):
        self.expression("MIT OR LGPL-3.0-only")
        self.exception()
        self.invoke(code=1)

    def test_native_payload_needs_separate_exact_review(self):
        self.inventory["payloads"][0]["kind"] = "native"
        self.invoke(code=1)
        self.native_review()
        self.invoke()
        original = copy.deepcopy(self.policy["reviewedPayloads"][0])
        for key, value in [("rid", "win-x64"), ("path", "other/lib.so"), ("sha256", "b" * 64),
                           ("kind", "data"), ("packageId", "Other"), ("packageVersion", "2.0"),
                           ("licenseExpression", "Apache-2.0")]:
            with self.subTest(key=key):
                self.policy["reviewedPayloads"] = [dict(original, **{key: value})]
                self.invoke(code=1)

    def test_native_lgpl_needs_owner_and_payload_review(self):
        self.expression("LGPL-2.1-or-later")
        self.exception()
        self.inventory["packages"][0]["deployment"] = copy.deepcopy(DEPLOYMENT)
        self.inventory["payloads"][0]["kind"] = "native"
        self.native_review()
        self.invoke()

    def test_data_owned_by_approved_package_passes(self):
        self.inventory["payloads"][0]["kind"] = "data"
        self.invoke()

    def test_ownership_must_be_exact(self):
        for key, value in [("packageId", "Unknown.Owner"), ("packageVersion", "2.0"),
                           ("packageId", None), ("packageVersion", None)]:
            with self.subTest(key=key):
                self.inventory["payloads"][0] = dict(self.inventory["payloads"][0],
                    packageId="Example.Core", packageVersion="1.0.0")
                self.inventory["payloads"][0][key] = value
                self.invoke(code=2 if value is None else 1)

    def test_unowned_only_null_owner_with_separate_review(self):
        self.inventory["payloads"][0].update(kind="unowned", packageId=None, packageVersion=None)
        self.invoke(code=1)
        self.native_review()
        self.invoke()
        self.inventory["payloads"][0]["packageId"] = "Example.Core"
        self.inventory["payloads"][0]["packageVersion"] = "1.0.0"
        self.invoke(code=2)

    def test_unowned_restricted_only_sane_linking_exception(self):
        self.inventory["payloads"][0].update(kind="unowned", packageId=None, packageVersion=None)
        self.native_review()
        for expr, code in [("GPL-2.0-or-later WITH SANE-exception", 0), ("GPL-3.0-only", 1),
                           ("LGPL-2.1-or-later", 1), ("AGPL-3.0-only", 1),
                           ("MIT OR GPL-2.0-only WITH SANE-exception", 1), ("Unknown", 1)]:
            with self.subTest(expression=expr):
                self.policy["reviewedPayloads"][0]["licenseExpression"] = expr
                self.invoke(code=code)

    def test_empty_payload_inventory_is_valid(self):
        self.inventory["payloads"] = []
        self.invoke()

    def test_forbidden_packages_never_cleared(self):
        for package_id in ["Dynamsoft", "Company.DYNAMSOFT.Binary", "NAPS2.Images.ImageSharp", "SixLabors.ImageSharp", "SixLabors.ImageSharp.Drawing",
                           "NAPS2", "NAPS2.App", "NAPS2.Application", "NAPS2.Console", "NAPS2.Desktop"]:
            with self.subTest(package=package_id):
                self.inventory["packages"][0]["id"] = package_id
                self.inventory["payloads"][0]["packageId"] = package_id
                self.policy["packages"] = [self.pin()]
                self.exception()
                self.invoke(code=1)

    def test_dynamsoft_source_and_path_always_forbidden(self):
        self.inventory["packages"][0]["source"] = "https://example.org/Dynamsoft/original"
        self.invoke(code=1)
        self.inventory["packages"][0]["source"] = "NuGet archive"
        self.inventory["payloads"][0]["path"] = "assets/dYnAmSoFt-logo.png"
        self.native_review()
        self.invoke(code=1)

    def test_naps2_application_code_never_cleared(self):
        self.inventory["packages"][0]["id"] = "NAPS2.Sdk"
        self.policy["packages"] = [self.pin()]
        self.inventory["payloads"][0].update(packageId="NAPS2.Sdk", kind="application-code")
        self.exception()
        self.native_review()
        self.invoke(code=1)

    def test_other_application_code_owned_permissive_passes(self):
        self.inventory["payloads"][0]["kind"] = "application-code"
        self.invoke()

    def test_unsafe_payload_paths_rejected(self):
        for path in ["/tmp/a", "../a", "lib/../a", "./a", "lib//a", "C:/a", "a\\b", "a/", "a\u0000b"]:
            with self.subTest(path=path):
                self.inventory["payloads"][0]["path"] = path
                self.invoke(code=2)

    def test_duplicate_payload_paths_case_insensitive(self):
        for path in ["lib/Example.dll", "LIB/EXAMPLE.DLL"]:
            self.inventory["payloads"] = [self.inventory["payloads"][0],
                dict(self.inventory["payloads"][0], path=path)]
            self.invoke(code=2)

    def test_duplicate_package_ids_inventory_and_policy(self):
        self.inventory["packages"].append(dict(self.inventory["packages"][0], id="EXAMPLE.CORE"))
        self.invoke(code=2)
        self.inventory["packages"].pop()
        for key in ["packages", "exceptions"]:
            self.exception()
            self.policy[key].append(dict(self.policy[key][0], id="EXAMPLE.CORE"))
            self.invoke(code=2)
            self.policy[key].pop()

    def test_duplicate_review_binding_rejected(self):
        self.native_review()
        self.policy["reviewedPayloads"].append(copy.deepcopy(self.policy["reviewedPayloads"][0]))
        self.invoke(code=2)

    def test_hashes_are_canonical_and_correct_type(self):
        for value in [None, 123, "0" * 128, HASH.rstrip("="), base64.b64encode(b"x").decode(), " " + HASH]:
            with self.subTest(sha512=value):
                self.inventory["packages"][0]["sha512"] = value
                self.invoke(code=2)
        self.inventory["packages"][0]["sha512"] = HASH
        for value in [None, 123, "A" * 64, "a" * 63, "g" * 64]:
            self.inventory["payloads"][0]["sha256"] = value
            self.invoke(code=2)

    def test_missing_required_fields_and_unknown_fields(self):
        for target in [self.inventory, self.inventory["packages"][0], self.inventory["payloads"][0],
                       self.policy, self.policy["packages"][0]]:
            for key in list(target):
                value = target.pop(key)
                self.invoke(code=2)
                target[key] = value
            target["unexpected"] = True
            self.invoke(code=2)
            del target["unexpected"]

    def test_empty_unknown_required_metadata_rejected(self):
        for target, key in [(self.inventory, "rid"), (self.inventory["packages"][0], "source"),
                            (self.inventory["packages"][0], "licenseFile"),
                            (self.inventory["packages"][0], "id"), (self.inventory["packages"][0], "version")]:
            original = target[key]
            for value in ["", " ", "unknown", "UNKNOWN", "TBD", "N/A", None, True, 1]:
                if key == "licenseFile" and value is None:
                    continue  # Nullable under the evidence-mapping contract.
                target[key] = value
                self.invoke(code=2)
            target[key] = original

    def test_invalid_root_types_and_empty_packages(self):
        for text in ["null", "[]", "true", "1", "\"text\""]:
            self.invoke(inventory=text, code=2)
            self.invoke(policy=text, code=2)
        for target in [self.inventory, self.policy]:
            target["schemaVersion"] = True
            self.invoke(code=2)
            target["schemaVersion"] = 1
        self.inventory["packages"] = []
        self.invoke(code=2)

    def test_invalid_array_types(self):
        for target, key in [(self.inventory, "packages"), (self.inventory, "payloads"),
                            (self.policy, "packages"), (self.policy, "exceptions"),
                            (self.policy, "reviewedPayloads"), (self.policy, "allowedExpressions")]:
            original = target[key]
            for value in [None, {}, "text", True, [None]]:
                target[key] = value
                self.invoke(code=2)
            target[key] = original

    def test_malformed_json_duplicate_keys_and_nonfinite_numbers(self):
        for text in ["", "{", '{"schemaVersion":1,"schemaVersion":1}',
                     json.dumps(self.inventory).replace('"version": "1.0.0"',
                         '"version":"1.0.0","version":"1.0.0"'), '{"x": NaN}']:
            with self.subTest(text=text):
                self.invoke(inventory=text, code=2)
                self.invoke(policy=text, code=2)

    def test_cli_missing_file_is_structured_invalid(self):
        run = subprocess.run([sys.executable, str(GATE), "check", str(self.root / "absent"),
            "--policy", str(self.root / "absent-policy")], capture_output=True, text=True)
        self.assertEqual(run.returncode, 2)
        self.assertEqual(json.loads(run.stdout)["status"], "invalid")
        self.assertNotIn("Traceback", run.stderr)

    def test_cli_usage_returns_two(self):
        for args in [[], ["check"], ["other"]]:
            run = subprocess.run([sys.executable, str(GATE)] + args, capture_output=True, text=True)
            self.assertEqual(run.returncode, 2)

    def test_missing_or_malformed_payload_review_fields_rejected(self):
        self.inventory["payloads"][0]["kind"] = "native"
        self.native_review()
        review = self.policy["reviewedPayloads"][0]
        for key in list(review):
            original = review.pop(key)
            self.invoke(code=2)
            review[key] = original
        for key in ["obligations", "provenance"]:
            original = review[key]
            review[key] = []
            self.invoke(code=2)
            review[key] = original
        review["review"]["unexpected"] = "no"
        self.invoke(code=2)

    def test_policy_hashes_and_payload_hashes_validate_even_if_unused(self):
        original = self.policy["packages"][0]["sha512"]
        self.policy["packages"][0]["sha512"] = "not a hash"
        self.invoke(code=2)
        self.policy["packages"][0]["sha512"] = original
        self.exception()
        self.policy["exceptions"][0]["sha512"] = "not a hash"
        self.invoke(code=2)
        self.policy["exceptions"] = []
        self.native_review()
        self.policy["reviewedPayloads"][0]["sha256"] = "NOT A HASH"
        self.invoke(code=2)

    def test_wrong_schema_versions_are_invalid(self):
        for target in [self.inventory, self.policy]:
            for value in [0, 2, 1.0, "1", None, False]:
                target["schemaVersion"] = value
                self.invoke(code=2)
            target["schemaVersion"] = 1

    def test_deployment_types_and_missing_fields_are_invalid(self):
        self.expression("LGPL-2.1-or-later")
        self.exception()
        self.inventory["packages"][0]["deployment"] = copy.deepcopy(DEPLOYMENT)
        deployment = self.inventory["packages"][0]["deployment"]
        for key in list(deployment):
            original = deployment.pop(key)
            self.invoke(code=2)
            deployment[key] = original
            deployment[key] = 1
            self.invoke(code=2)
            deployment[key] = original

    def test_all_bounded_permissive_atoms(self):
        for expression in ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD",
                           "Zlib", "BSL-1.0", "Unlicense", "CC0-1.0"]:
            with self.subTest(expression=expression):
                self.expression(expression)
                self.policy["allowedExpressions"] = [expression]
                self.invoke()

    def test_expression_whitespace_and_parentheses_do_not_normalize_pins(self):
        self.expression("(MIT OR Apache-2.0)")
        self.exception()
        self.invoke()
        self.policy["exceptions"][0]["licenseExpression"] = "MIT OR Apache-2.0"
        self.invoke(code=1)
        self.policy["exceptions"][0]["licenseExpression"] = "(MIT  OR Apache-2.0)"
        self.invoke(code=1)

    def test_windows_ambiguous_paths_denied(self):
        for path in ["//server/file", "dir/a.", "dir/a ", "con", "aux.dll", "LPT1.log", "a:b", "a?b"]:
            self.inventory["payloads"][0]["path"] = path
            self.invoke(code=2)

    def test_io_existing_inventory_missing_policy_and_invalid_utf8(self):
        inv_path, pol_path = self.root / "inventory.json", self.root / "policy.json"
        inv_path.write_text(json.dumps(self.inventory))
        for content in [None, b"\xff\xfe\x00"]:
            if content is not None:
                pol_path.write_bytes(content)
            run = subprocess.run([sys.executable, str(GATE), "check", str(inv_path),
                "--policy", str(pol_path)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 2)
            self.assertEqual(json.loads(run.stdout)["status"], "invalid")
            self.assertEqual(run.stderr, "")

    def test_file_mapped_permissive_passes_with_exact_evidence(self):
        self.file_mapping()
        self.invoke()

    def test_explicit_expression_allows_null_license_file(self):
        self.inventory["packages"][0]["licenseFile"] = None
        self.invoke()

    def test_both_null_license_fields_are_invalid(self):
        self.inventory["packages"][0].update(licenseExpression=None, licenseFile=None)
        self.invoke(code=2)

    def test_file_mapping_inventory_requires_canonical_file_hash(self):
        self.file_mapping()
        del self.inventory["packages"][0]["licenseFileSha256"]
        self.invoke(code=2)
        for value in [None, "c" * 63, "C" * 64, 123, "unknown"]:
            self.inventory["packages"][0]["licenseFileSha256"] = value
            self.invoke(code=2)

    def test_optional_file_hash_still_validates_with_explicit_expression(self):
        self.inventory["packages"][0]["licenseFileSha256"] = "c" * 64
        self.invoke()
        self.inventory["packages"][0]["licenseFileSha256"] = "invalid"
        self.invoke(code=2)

    def test_file_mapping_needs_all_six_policy_evidence_fields(self):
        self.file_mapping()
        pin = self.policy["packages"][0]
        for field in ["licenseFile", "licenseFileSha256", "source", "review", "obligations", "provenance"]:
            with self.subTest(field=field):
                original = pin.pop(field)
                self.invoke(code=2 if field in {"review", "obligations", "provenance"} else 1)
                pin[field] = original
        self.policy["packages"] = [{key: pin[key] for key in ("id", "version", "sha512", "licenseExpression")}]
        self.invoke(code=1)

    def test_file_mapping_evidence_drift_denied(self):
        self.file_mapping()
        pin = self.policy["packages"][0]
        for field, drift in [("licenseFile", "other/LICENSE.txt"), ("licenseFileSha256", "d" * 64),
                             ("source", "https://other.invalid/archive"), ("version", "2.0"),
                             ("sha512", OTHER_HASH)]:
            with self.subTest(field=field):
                original = pin[field]
                pin[field] = drift
                self.invoke(code=1)
                pin[field] = original

    def test_file_mapping_cannot_override_explicit_expression(self):
        self.file_mapping("Apache-2.0")
        self.inventory["packages"][0]["licenseExpression"] = "MIT"
        self.invoke(code=1)

    def test_mapping_restricted_license_still_needs_exact_legal_exception(self):
        self.file_mapping("GPL-2.0-or-later WITH SANE-exception")
        pin = self.policy["packages"][0]
        pin["review"] = copy.deepcopy(REVIEW)
        self.invoke(code=1)
        self.policy["exceptions"] = [dict({key: pin[key] for key in
            ("id", "version", "sha512", "licenseExpression")}, review=copy.deepcopy(REVIEW),
            obligations=OBLIGATIONS[:], provenance=["Reviewed upstream SANE license"])]
        self.invoke()
        self.policy["exceptions"][0]["review"]["reference"] = EVIDENCE_REFERENCE
        self.invoke(code=2)

    def test_mapping_unknown_license_not_laundered_by_review(self):
        self.file_mapping("LicenseRef-Invented")
        self.policy["packages"][0]["review"] = copy.deepcopy(REVIEW)
        self.invoke(code=1)

    def test_file_mapping_cannot_override_unconditional_ban(self):
        self.file_mapping()
        self.inventory["packages"][0]["id"] = "Dynamsoft.Core"
        self.policy["packages"][0]["id"] = "Dynamsoft.Core"
        self.inventory["payloads"][0]["packageId"] = "Dynamsoft.Core"
        self.invoke(code=1)

    def test_conditional_lgpl_allowed_without_restricted_exception(self):
        for expression in ["LGPL-2.1-only", "LGPL-2.1-or-later"]:
            with self.subTest(expression=expression):
                self.expression(expression)
                self.package_evidence()
                self.policy["allowedExpressions"] = [expression]
                self.inventory["packages"][0]["deployment"] = copy.deepcopy(DEPLOYMENT)
                self.invoke()
                self.inventory["packages"][0]["licenseFile"] = None
                self.invoke()

    def test_file_mapped_conditional_lgpl_without_exception(self):
        self.file_mapping("LGPL-2.1-or-later")
        self.policy["allowedExpressions"] = ["LGPL-2.1-or-later"]
        self.inventory["packages"][0]["deployment"] = copy.deepcopy(DEPLOYMENT)
        self.invoke()

    def test_conditional_lgpl_missing_normal_review_cannot_use_exception_to_bypass(self):
        self.expression("LGPL-2.1-only")
        self.policy["allowedExpressions"] = ["LGPL-2.1-only"]
        self.inventory["packages"][0]["deployment"] = copy.deepcopy(DEPLOYMENT)
        self.exception()
        self.invoke(code=1)

    def test_conditional_lgpl_missing_obligations_or_deployment_denied(self):
        self.expression("LGPL-2.1-or-later")
        self.package_evidence()
        self.policy["allowedExpressions"] = ["LGPL-2.1-or-later"]
        pin = self.policy["packages"][0]
        self.invoke(code=1)
        for field, drift in [("linkage", "static"), ("separateDll", False), ("replaceable", False),
                             ("trimmed", True), ("merged", True), ("singleFile", True)]:
            self.inventory["packages"][0]["deployment"] = dict(DEPLOYMENT, **{field: drift})
            self.invoke(code=1)
        self.inventory["packages"][0]["deployment"] = copy.deepcopy(DEPLOYMENT)
        for obligation in OBLIGATIONS:
            pin["obligations"] = [item for item in OBLIGATIONS if item != obligation]
            self.invoke(code=1)
        pin["obligations"] = OBLIGATIONS[:]
        for field in ["obligations", "provenance"]:
            original = pin[field]
            pin[field] = []
            self.invoke(code=2)
            pin[field] = original

    def test_other_lgpl_atoms_cannot_expand_conditional_catalog(self):
        for expression in ["LGPL-2.1", "LGPL-2.1+", "LGPL-3.0-only", "MIT OR LGPL-2.1-only"]:
            self.policy["allowedExpressions"] = [expression]
            self.invoke(code=2)

    def test_file_mapped_native_review_uses_effective_owner_expression(self):
        self.file_mapping("LGPL-2.1-only")
        self.policy["allowedExpressions"] = ["LGPL-2.1-only"]
        self.inventory["packages"][0]["deployment"] = copy.deepcopy(DEPLOYMENT)
        self.inventory["payloads"][0]["kind"] = "native"
        self.native_review()
        review = self.policy["reviewedPayloads"][0]
        review.update(licenseExpression="LGPL-2.1-only", review=dict(REVIEW, reference=EVIDENCE_REFERENCE))
        self.invoke()
        review["licenseExpression"] = "MIT"
        self.invoke(code=1)

    def test_restricted_native_and_unowned_reviews_cannot_use_spike_reference(self):
        self.expression("GPL-2.0-or-later WITH SANE-exception")
        self.exception()
        self.inventory["payloads"][0]["kind"] = "native"
        self.native_review()
        self.policy["reviewedPayloads"][0]["review"]["reference"] = EVIDENCE_REFERENCE
        self.invoke(code=2)
        self.inventory["payloads"][0].update(kind="unowned", packageId=None, packageVersion=None)
        self.native_review()
        self.policy["reviewedPayloads"][0]["review"]["reference"] = EVIDENCE_REFERENCE
        self.invoke(code=2)

    def test_conditional_catalog_never_clears_unowned_lgpl(self):
        self.policy["allowedExpressions"].append("LGPL-2.1-only")
        self.inventory["payloads"][0].update(kind="unowned", packageId=None, packageVersion=None)
        self.native_review()
        self.policy["reviewedPayloads"][0]["licenseExpression"] = "LGPL-2.1-only"
        self.invoke(code=1)

    def test_documented_fixture_exit_codes(self):
        fixtures = GATE.parent / "fixtures"
        for inventory, policy, code in [
            ("permissive-inventory.json", "permissive-policy.json", 0),
            ("denied-inventory.json", "permissive-policy.json", 1),
            ("reviewed-sane-inventory.json", "reviewed-sane-policy.json", 0),
            ("file-mapped-lgpl-inventory.json", "file-mapped-lgpl-policy.json", 0),
        ]:
            with self.subTest(inventory=inventory):
                run = subprocess.run([sys.executable, str(GATE), "check", str(fixtures / inventory),
                    "--policy", str(fixtures / policy)], capture_output=True, text=True)
                self.assertEqual(run.returncode, code, (run.stdout, run.stderr))
                self.assertEqual(json.loads(run.stdout)["status"], "denied" if code else "passed")
                self.assertEqual(run.stderr, "")


if __name__ == "__main__":
    unittest.main()
