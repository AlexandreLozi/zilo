#!/usr/bin/env python3
"""Default-deny D-002 metadata gate (Python stdlib only).

This compares producer-supplied inventory metadata with reviewed policy. It does
NOT inspect payload bytes, attest license truth, verify source provenance, or
prove inventory completeness. Those producer/reviewer evidence boundaries must
be checked independently before release.

Only PERMISSIVE and CONDITIONAL atoms can enter allowedExpressions. Conditional
LGPL approval additionally requires evidence, obligations and deployment checks.
KNOWN_ATOMS is bounded, not the complete SPDX catalog. Every other known
expression, including all compounds, requires an exact reviewed exception; no
OR branch is selected. Null raw expressions require exact license-file mapping.
The Split LicenseRef below is an explicitly recognized local restricted label,
not a claim that the Split License has an SPDX-listed identifier.
"""
import argparse
import base64
import binascii
from datetime import date
import json
from pathlib import Path
import re


PERMISSIVE = frozenset({"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC",
                        "0BSD", "Zlib", "BSL-1.0", "Unlicense", "CC0-1.0"})
CONDITIONAL = frozenset({"LGPL-2.1-only", "LGPL-2.1-or-later"})
GPL_ATOMS = frozenset({
    "GPL-1.0", "GPL-1.0+", "GPL-1.0-only", "GPL-1.0-or-later",
    "GPL-2.0", "GPL-2.0+", "GPL-2.0-only", "GPL-2.0-or-later",
    "GPL-3.0", "GPL-3.0+", "GPL-3.0-only", "GPL-3.0-or-later",
    "AGPL-1.0", "AGPL-1.0-only", "AGPL-1.0-or-later",
    "AGPL-3.0", "AGPL-3.0+", "AGPL-3.0-only", "AGPL-3.0-or-later",
    "LGPL-2.0", "LGPL-2.0+", "LGPL-2.0-only", "LGPL-2.0-or-later",
    "LGPL-2.1", "LGPL-2.1+", "LGPL-2.1-only", "LGPL-2.1-or-later",
    "LGPL-3.0", "LGPL-3.0+", "LGPL-3.0-only", "LGPL-3.0-or-later"})
KNOWN_ATOMS = PERMISSIVE | GPL_ATOMS | frozenset({
    "MPL-1.1", "MPL-2.0", "EPL-1.0", "EPL-2.0", "CDDL-1.0", "CDDL-1.1",
    "MS-PL", "MS-RL", "Artistic-2.0", "OFL-1.1", "OpenSSL", "SSLeay",
    "BSD-4-Clause", "Python-2.0", "PSF-2.0", "Libpng", "bzip2-1.0.6", "IJG",
    "LicenseRef-Six-Labors-Split-License"})
SANE_BASES = frozenset({"GPL-2.0", "GPL-2.0+", "GPL-2.0-only", "GPL-2.0-or-later"})
KINDS = frozenset({"managed", "native", "data", "unowned", "application-code"})
PIN_FIELDS = frozenset({"id", "version", "sha512", "licenseExpression"})
PAYLOAD_FIELDS = frozenset({"path", "sha256", "kind", "packageId", "packageVersion"})
REVIEW_FIELDS = frozenset({"review", "obligations", "provenance"})
FILE_FIELDS = frozenset({"licenseFile", "licenseFileSha256", "source"})
EVIDENCE_FIELDS = FILE_FIELDS | REVIEW_FIELDS
EVIDENCE_REFERENCE = "docs/spikes/SP-2a.md#license-evidence"
DEPLOYMENT = {"linkage": "dynamic", "separateDll": True, "replaceable": True,
              "trimmed": False, "merged": False, "singleFile": False}
LGPL_OBLIGATIONS = frozenset({"license-text", "notice", "source-offer", "replaceable-dll"})
PLACEHOLDERS = frozenset({"unknown", "tbd", "todo", "n/a", "none", "null", "unspecified",
                          "noassertion", "not known", "placeholder", "?"})
APP_IDS = frozenset({"naps2", "naps2.app", "naps2.application", "naps2.console", "naps2.desktop"})


class Invalid(ValueError):
    """Malformed, incomplete, or ambiguous input metadata."""


def require(condition, message):
    if not condition:
        raise Invalid(message)


def obj(value, required, where, optional=frozenset()):
    require(type(value) is dict, f"{where}: expected object")
    require(required <= value.keys(), f"{where}: missing fields {sorted(required - value.keys())}")
    require(value.keys() <= required | optional,
            f"{where}: unknown fields {sorted(value.keys() - required - optional)}")


def text(value, where, expression=False):
    require(type(value) is str and bool(value.strip()), f"{where}: nonempty string required")
    require(value == value.strip() and not any(ord(c) < 32 or 127 <= ord(c) <= 159
            or 0xD800 <= ord(c) <= 0xDFFF for c in value), f"{where}: invalid string")
    require(expression or value.casefold() not in PLACEHOLDERS, f"{where}: placeholder metadata")


def array(value, where, nonempty=False):
    require(type(value) is list, f"{where}: expected array")
    require(not nonempty or bool(value), f"{where}: empty array")


def string_array(value, where, nonempty=False):
    array(value, where, nonempty)
    for index, item in enumerate(value):
        text(item, f"{where}[{index}]")


def sha512(value, where):
    text(value, where)
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise Invalid(f"{where}: invalid NuGet base64 sha512") from exc
    require(len(raw) == 64 and base64.b64encode(raw).decode("ascii") == value,
            f"{where}: expected canonical base64 of 64 bytes")


def payload_path(value, where):
    text(value, where)
    require(not any(c in value for c in '\\:<>"|?*'), f"{where}: ambiguous path")
    parts = value.split("/")
    require(all(p and p not in {".", ".."} and not p.endswith((".", " ")) for p in parts),
            f"{where}: expected canonical POSIX relative path")
    # Avoid Windows device aliases, including aliases with extensions.
    require(not any(re.fullmatch(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])",
            p.split(".")[0], re.IGNORECASE) for p in parts), f"{where}: Windows device path")


def pin_metadata(value, where, nullable_expression=False):
    for field in ("id", "version", "licenseExpression"):
        if field == "licenseExpression" and nullable_expression and value[field] is None:
            continue
        text(value[field], f"{where}.{field}", expression=field == "licenseExpression")
    require(re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", value["id"]),
            f"{where}.id: invalid NuGet ID")
    sha512(value["sha512"], f"{where}.sha512")


def review_metadata(value, where, ordinary=False):
    review = value["review"]
    obj(review, frozenset({"reviewer", "date", "reference"}), f"{where}.review")
    for key in review:
        text(review[key], f"{where}.review.{key}")
    require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", review["date"]), f"{where}: expected YYYY-MM-DD")
    try:
        date.fromisoformat(review["date"])
    except ValueError as exc:
        raise Invalid(f"{where}: invalid review date") from exc
    legal = re.fullmatch(r"docs/legal/exceptions\.md#[A-Za-z0-9][A-Za-z0-9_.:-]*", review["reference"])
    require(legal or (ordinary and review["reference"] == EVIDENCE_REFERENCE),
            f"{where}: review must reference legal exception anchor"
            + (" or ordinary license evidence" if ordinary else ""))
    for key in ("obligations", "provenance"):
        string_array(value[key], f"{where}.{key}", nonempty=True)


def sha256(value, where):
    require(type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value),
            f"{where}: expected lowercase SHA-256 hex")


def payload_metadata(value, where):
    payload_path(value["path"], f"{where}.path")
    sha256(value["sha256"], f"{where}.sha256")
    require(type(value["kind"]) is str and value["kind"] in KINDS, f"{where}: unsupported kind")
    if value["kind"] == "unowned":
        require(value["packageId"] is None and value["packageVersion"] is None,
                f"{where}: unowned payload must have null owner")
    else:
        text(value["packageId"], f"{where}.packageId")
        text(value["packageVersion"], f"{where}.packageVersion")


def unique(items, key, where):
    seen = set()
    for item in items:
        identity = key(item)
        require(identity not in seen, f"{where}: duplicate/ambiguous identity {identity}")
        seen.add(identity)


def validate(inventory, policy):
    obj(inventory, frozenset({"schemaVersion", "rid", "packages", "payloads"}), "inventory")
    obj(policy, frozenset({"schemaVersion", "allowedExpressions", "packages", "exceptions",
                           "reviewedPayloads"}), "policy")
    for name, root in (("inventory", inventory), ("policy", policy)):
        require(type(root["schemaVersion"]) is int and root["schemaVersion"] == 1,
                f"{name}: schemaVersion must be integer 1")
    text(inventory["rid"], "inventory.rid")
    array(inventory["packages"], "inventory.packages", nonempty=True)
    array(inventory["payloads"], "inventory.payloads")
    for index, package in enumerate(inventory["packages"]):
        where = f"inventory.packages[{index}]"
        obj(package, PIN_FIELDS | {"licenseFile", "source"}, where, {"deployment", "licenseFileSha256"})
        pin_metadata(package, where, nullable_expression=True)
        text(package["source"], f"{where}.source")
        require(package["licenseExpression"] is not None or package["licenseFile"] is not None,
                f"{where}: licenseExpression and licenseFile cannot both be null")
        if package["licenseFile"] is not None:
            text(package["licenseFile"], f"{where}.licenseFile")
        if package["licenseExpression"] is None:
            require("licenseFileSha256" in package, f"{where}: null expression requires licenseFileSha256")
        if "licenseFileSha256" in package:
            sha256(package["licenseFileSha256"], f"{where}.licenseFileSha256")
        if "deployment" in package:
            deployment = package["deployment"]
            obj(deployment, frozenset(DEPLOYMENT), f"{where}.deployment")
            text(deployment["linkage"], f"{where}.deployment.linkage")
            for key in DEPLOYMENT.keys() - {"linkage"}:
                require(type(deployment[key]) is bool, f"{where}.deployment.{key}: expected boolean")
    unique(inventory["packages"], lambda p: p["id"].casefold(), "inventory.packages")
    for index, payload in enumerate(inventory["payloads"]):
        where = f"inventory.payloads[{index}]"
        obj(payload, PAYLOAD_FIELDS, where)
        payload_metadata(payload, where)
    unique(inventory["payloads"], lambda p: p["path"].casefold(), "inventory.payloads")
    string_array(policy["allowedExpressions"], "policy.allowedExpressions")
    require(all(x in PERMISSIVE | CONDITIONAL for x in policy["allowedExpressions"]),
            "policy.allowedExpressions: only bounded permissive or conditional SPDX atoms may be allowed")
    unique(policy["allowedExpressions"], lambda p: p, "policy.allowedExpressions")
    for key in ("packages", "exceptions"):
        array(policy[key], f"policy.{key}")
        for index, entry in enumerate(policy[key]):
            where = f"policy.{key}[{index}]"
            obj(entry, PIN_FIELDS | (REVIEW_FIELDS if key == "exceptions" else set()), where,
                EVIDENCE_FIELDS if key == "packages" else set())
            pin_metadata(entry, where)
            if key == "exceptions":
                review_metadata(entry, where)
            else:
                for field in FILE_FIELDS & entry.keys():
                    if field == "licenseFileSha256":
                        sha256(entry[field], f"{where}.{field}")
                    else:
                        text(entry[field], f"{where}.{field}")
                if REVIEW_FIELDS & entry.keys():
                    require(REVIEW_FIELDS <= entry.keys(), f"{where}: incomplete review evidence")
                    review_metadata(entry, where, ordinary=entry["licenseExpression"] in PERMISSIVE | CONDITIONAL)
        unique(policy[key], lambda p: p["id"].casefold(), f"policy.{key}")
    array(policy["reviewedPayloads"], "policy.reviewedPayloads")
    for index, payload in enumerate(policy["reviewedPayloads"]):
        where = f"policy.reviewedPayloads[{index}]"
        obj(payload, PAYLOAD_FIELDS | REVIEW_FIELDS | {"rid", "licenseExpression"}, where)
        payload_metadata(payload, where)
        text(payload["rid"], f"{where}.rid")
        text(payload["licenseExpression"], f"{where}.licenseExpression", expression=True)
        review_metadata(payload, where, ordinary=payload["licenseExpression"] in PERMISSIVE | CONDITIONAL)
    unique(policy["reviewedPayloads"], lambda p: (p["rid"], p["path"].casefold()),
           "policy.reviewedPayloads")


class Expression:
    """Small bounded SPDX grammar: OR < AND < WITH, with parentheses.

    Parsing recognizes known syntax only. The original string is always used for
    policy equality. SANE-exception is recognized only on GPL-2.0 atoms.
    """
    def __init__(self, value):
        self.tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9.+-]*|[()]|\S", value)
        self.index = 0
        self.atoms = set()

    def take(self, token):
        if self.index < len(self.tokens) and self.tokens[self.index] == token:
            self.index += 1
            return True
        return False

    def parse(self):
        require(len(self.tokens) <= 256, "expression too complex")
        self.disjunction()
        require(self.index == len(self.tokens), "invalid trailing SPDX tokens")
        return self.atoms

    def disjunction(self):
        self.conjunction()
        while self.take("OR"):
            self.conjunction()

    def conjunction(self):
        self.term()
        while self.take("AND"):
            self.term()

    def term(self):
        if self.take("("):
            self.disjunction()
            require(self.take(")"), "unclosed SPDX parenthesis")
            return
        require(self.index < len(self.tokens), "missing SPDX atom")
        atom = self.tokens[self.index]
        self.index += 1
        require(atom in KNOWN_ATOMS, f"unknown SPDX atom: {atom}")
        self.atoms.add(atom)
        if self.take("WITH"):
            require(atom in SANE_BASES and self.take("SANE-exception"), "unknown/unsupported SPDX exception")


def known_expression(value):
    try:
        return Expression(value).parse()
    except (Invalid, RecursionError):
        return None


def pin_key(package):
    return (package["id"].casefold(), package["version"], package["sha512"], package["licenseExpression"])


def payload_key(payload, rid):
    return (rid, payload["path"], payload["sha256"], payload["kind"],
            payload["packageId"].casefold() if payload["packageId"] is not None else None,
            payload["packageVersion"])


def forbidden_identity(value):
    lowered = value.casefold()
    if any(banned in lowered for banned in ("dynamsoft", "naps2.images.imagesharp", "sixlabors.imagesharp")):
        return True
    # Detect application identities in paths/source strings as well as IDs.
    tokens = re.split(r"[/\\:#?=&\s]+", lowered)
    return any(token in APP_IDS or any(token.startswith(app + ".")
        for app in APP_IDS - {"naps2"}) or token in {"naps2.exe", "naps2.dll"} for token in tokens)


def check(inventory, policy):
    errors = []
    allowed = set(policy["allowedExpressions"])
    pins = {p["id"].casefold(): p for p in policy["packages"]}
    exceptions = {pin_key(p): p for p in policy["exceptions"]}
    approved = {}
    for package in inventory["packages"]:
        identity = package["id"]
        pin = pins.get(identity.casefold())
        raw_expression = package["licenseExpression"]
        expression = pin["licenseExpression"] if raw_expression is None and pin else raw_expression
        effective = dict(package, licenseExpression=expression)
        key = pin_key(effective)
        atoms = known_expression(expression) if expression is not None else None
        problem = None
        if any(forbidden_identity(package[field]) for field in ("id", "source", "licenseFile")
               if package[field] is not None):
            problem = "unconditionally forbidden D-002 identity/source"
        elif pin is None or key != pin_key(pin):
            problem = "missing exact package policy pin (id/version/hash/expression)"
        elif raw_expression is None and not EVIDENCE_FIELDS <= pin.keys():
            problem = "null raw expression requires complete policy license-file evidence mapping"
        elif raw_expression is None and any(pin[field] != package[field] for field in FILE_FIELDS):
            problem = "license-file evidence mapping differs from inventory filename/hash/source"
        elif atoms is None:
            problem = "unknown or malformed license expression"
        elif expression not in allowed and key not in exceptions:
            problem = "license requires exact reviewed package exception"
        elif any(atom.startswith("LGPL-") for atom in atoms):
            # Conditional allowlisting never borrows an exception's evidence to
            # bypass the required normal package review and canonical duties.
            evidence = pin if expression in allowed & CONDITIONAL else exceptions.get(key)
            if package.get("deployment") != DEPLOYMENT:
                problem = "LGPL requires dynamic, separate, replaceable, untrimmed/unmerged DLL deployment"
            elif not evidence or not REVIEW_FIELDS <= evidence.keys():
                problem = "LGPL requires complete reviewed redistribution evidence"
            elif not LGPL_OBLIGATIONS <= set(evidence["obligations"]):
                problem = "LGPL review missing required redistribution obligations"
        if problem:
            errors.append(f"package {identity}@{package['version']}: {problem}")
        else:
            approved[(identity.casefold(), package["version"])] = effective

    reviews = {payload_key(p, p["rid"]): p for p in policy["reviewedPayloads"]}
    for payload in inventory["payloads"]:
        path = payload["path"]
        package_id = payload["packageId"]
        if forbidden_identity(path) or (package_id is not None and forbidden_identity(package_id)):
            errors.append(f"payload {path}: unconditionally forbidden D-002 identity/path")
            continue
        if payload["kind"] == "application-code":
            problem = ("NAPS2 application code is never permitted"
                if package_id.casefold().split(".")[0] == "naps2"
                else "unsupported application-code owner")
            errors.append(f"payload {path}: {problem}")
            continue
        owner = None
        if payload["kind"] != "unowned":
            owner = approved.get((package_id.casefold(), payload["packageVersion"]))
            if owner is None:
                errors.append(f"payload {path}: exact approved inventory owner required")
                continue
        if payload["kind"] not in {"native", "unowned"}:
            continue
        review = reviews.get(payload_key(payload, inventory["rid"]))
        if review is None:
            errors.append(f"payload {path}: separate exact RID/path/hash/kind/owner review required")
            continue
        expression = review["licenseExpression"]
        atoms = known_expression(expression)
        if atoms is None:
            errors.append(f"payload {path}: unknown or malformed reviewed expression")
        elif owner is not None and expression != owner["licenseExpression"]:
            errors.append(f"payload {path}: reviewed expression differs from approved owner")
        elif owner is None and expression not in allowed & PERMISSIVE:
            # Only the entire exact GPL/SANE expression can clear restricted
            # unowned payloads. A compound/OR or unowned LGPL cannot clear it.
            if expression not in {f"{base} WITH SANE-exception" for base in SANE_BASES}:
                errors.append(f"payload {path}: restricted unowned license not eligible for review clearance")
    return errors


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def bad_constant(value):
    raise Invalid(f"invalid JSON numeric constant: {value}")


def load(path):
    with Path(path).open(encoding="utf-8") as stream:
        return json.load(stream, object_pairs_hook=no_duplicates, parse_constant=bad_constant)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("check", help="compare inventory metadata with reviewed policy")
    command.add_argument("inventory")
    command.add_argument("--policy", required=True)
    args = parser.parse_args(argv)
    packages = payloads = 0
    try:
        inventory = load(args.inventory)
        policy = load(args.policy)
        validate(inventory, policy)
        packages, payloads = len(inventory["packages"]), len(inventory["payloads"])
        errors = check(inventory, policy)
        code = 1 if errors else 0
    except (OSError, ValueError, UnicodeError, RecursionError) as exc:
        errors = [f"invalid metadata: {exc}"]
        code = 2
    print(json.dumps({"status": {0: "passed", 1: "denied", 2: "invalid"}[code],
                      "errors": errors, "packages": packages, "payloads": payloads}, ensure_ascii=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
