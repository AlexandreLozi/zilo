#!/usr/bin/env bash
# SP-4a step 2: test-key signing smoke, Linux only.
#
# Generates THROWAWAY keys at runtime inside <work-dir> and deletes the private material on exit.
# Nothing here is a production key; nothing is committed. A test-signed Windows build CANNOT
# satisfy Smart App Control (D-011 / OD-6): its root is not in the Windows trust store and it has
# no reputation, so SAC is expected to block it exactly like an unsigned build.
#
# usage: test-sign-smoke.sh <publish-win-dir> <deb> <rpm> <work-dir>
# Needs: openssl, osslsigncode, wixl, gpg, gpgv, rpmsign, rpmkeys, apt-ftparchive.
set -euo pipefail
pub=$(readlink -f "$1") deb=$(readlink -f "$2") rpmf=$(readlink -f "$3") work=$4
here=$(cd "$(dirname "$0")" && pwd)
rm -rf "$work"; mkdir -p "$work"; work=$(cd "$work" && pwd)
cleanup() { rm -rf "$work/pki/"*.key "$work/pki/"*.p12 "$work/gnupg/private-keys-v1.d"; }
trap cleanup EXIT
fail() { echo "SIGN SMOKE FAIL: $*"; exit 1; }
step() { printf '\n=== %s\n' "$*"; }

step "tool versions"
openssl version
osslsigncode --version 2>&1 | head -1
wixl --version
gpg --version | head -1
rpmsign --version 2>/dev/null || rpm --version

# --------------------------------------------------------------------------------------------
step "throwaway Authenticode PKI (self-signed root + code-signing leaf)"
mkdir -p "$work/pki"; cd "$work/pki"
openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 2 -subj "/CN=Zilo THROWAWAY Test Root" \
  -keyout root.key -out root.pem \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
openssl req -newkey rsa:3072 -nodes -sha256 -subj "/CN=Zilo THROWAWAY Test Code Signing" \
  -keyout leaf.key -out leaf.csr 2>/dev/null
printf '%s\n' "basicConstraints=critical,CA:FALSE" "keyUsage=critical,digitalSignature" \
  "extendedKeyUsage=critical,codeSigning" > leaf.ext
openssl x509 -req -in leaf.csr -CA root.pem -CAkey root.key -CAcreateserial -days 2 -sha256 \
  -extfile leaf.ext -out leaf.pem 2>/dev/null
openssl x509 -in leaf.pem -noout -subject -issuer -ext extendedKeyUsage

sign_verify() { # <in> <out> <label>
  osslsigncode sign -certs leaf.pem -key leaf.key -h sha256 \
    -n "Zilo Agent (test-signed dry run)" -i "https://zilo.invalid/" -in "$1" -out "$2" >/dev/null
  osslsigncode verify -CAfile root.pem -in "$2" > "$2.verify.txt" 2>&1 \
    || { cat "$2.verify.txt"; fail "$3: verify failed"; }
  grep -E '^Signature verification: ok' "$2.verify.txt" >/dev/null || { cat "$2.verify.txt"; fail "$3"; }
  echo "$3: Signature verification: ok"
}

step "sign + verify every PE in the Windows publish (agent exe and all Zilo DLLs)"
mkdir -p "$work/signed-win"
for f in "$pub"/*.exe "$pub"/*.dll; do
  n=$(basename "$f")
  sign_verify "$f" "$work/signed-win/$n" "$n"
done

step "negative controls"
if osslsigncode verify -CAfile root.pem -in "$pub/Zilo.Agent.exe" >/dev/null 2>&1; then
  fail "unsigned exe verified"
fi
echo "unsigned Zilo.Agent.exe: verification fails (expected)"
cp "$work/signed-win/Zilo.Agent.exe" tampered.exe
printf '\x90' | dd of=tampered.exe bs=1 seek=1024 conv=notrunc status=none
if osslsigncode verify -CAfile root.pem -in tampered.exe >/dev/null 2>&1; then
  fail "tampered exe verified"
fi
echo "tampered signed exe: verification fails (expected)"
openssl req -x509 -newkey rsa:2048 -nodes -subj "/CN=Unrelated Root" -keyout other.key -out other.pem \
  -days 1 2>/dev/null
if osslsigncode verify -CAfile other.pem -in "$work/signed-win/Zilo.Agent.exe" >/dev/null 2>&1; then
  fail "verified against an unrelated root"
fi
echo "signed exe against an unrelated root: verification fails (expected)"

step "MSI: build a signing-smoke MSI with wixl, sign it, verify"
wixl -a x64 -D PublishDir="$work/signed-win" -o "$work/smoke.msi" "$here/smoke-msi.wxs"
sign_verify "$work/smoke.msi" "$work/smoke-signed.msi" "smoke.msi"

# --------------------------------------------------------------------------------------------
step "throwaway GPG key"
export GNUPGHOME="$work/gnupg"; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
gpg --batch --quiet --passphrase '' --quick-gen-key "Zilo THROWAWAY packaging test key <test@zilo.invalid>" \
  ed25519 sign 2d
fpr=$(gpg --batch --with-colons --list-keys | awk -F: '/^fpr/ {print $10; exit}')
gpg --batch --armor --export "$fpr" > "$work/test-key.asc"
gpg --batch --export "$fpr" > "$work/test-keyring.gpg"
echo "key: $fpr"

step "rpm: rpmsign --addsign, verify with rpmkeys -K against a scratch keyring"
cp "$rpmf" "$work/signed.rpm"
rpmsign --define "__gpg $(command -v gpg)" --define "_gpg_name $fpr" --define "_gpg_path $GNUPGHOME" --addsign "$work/signed.rpm" >/dev/null
mkdir -p "$work/rpmdb"
rpmkeys --dbpath "$work/rpmdb" --import "$work/test-key.asc"
rpmkeys --dbpath "$work/rpmdb" -Kv "$work/signed.rpm" | tee "$work/rpm-verify.txt"
grep -q 'Signature, key ID .*: OK' "$work/rpm-verify.txt" || fail "rpm signature"
rpmkeys --dbpath "$work/rpmdb" -K "$work/signed.rpm" | grep -q 'signatures OK' || fail "rpm -K"
mkdir -p "$work/rpmdb-empty"
if rpmkeys --dbpath "$work/rpmdb-empty" -K "$work/signed.rpm" 2>&1 | grep -q 'signatures OK'; then
  fail "rpm verified without the key"
fi
echo "signed rpm without the key imported: not OK (expected)"

step "deb: signed apt repository metadata (InRelease), verify with gpgv"
mkdir -p "$work/repo/pool"; cp "$deb" "$work/repo/pool/"
cd "$work/repo"
apt-ftparchive packages pool > Packages
apt-ftparchive -o APT::FTPArchive::Release::Suite=dryrun release . > Release
gpg --batch --yes --clearsign --local-user "$fpr" -o InRelease Release
gpgv --keyring "$work/test-keyring.gpg" InRelease 2>&1 | tee "$work/deb-repo-verify.txt"
grep -q 'Good signature' "$work/deb-repo-verify.txt" || fail "InRelease"
# The chain: InRelease (signed) -> SHA256 of Packages -> SHA256 of the .deb.
pk=$(sha256sum Packages | cut -d' ' -f1)
grep -q "$pk" InRelease || fail "Packages hash not in InRelease"
dh=$(sha256sum "pool/$(basename "$deb")" | cut -d' ' -f1)
grep -q "SHA256: $dh" Packages || fail ".deb hash not in Packages"
echo "InRelease -> Packages -> .deb hash chain: ok"
sed -i 's/Suite: dryrun/Suite: tampered/' InRelease
if gpgv --keyring "$work/test-keyring.gpg" InRelease >/dev/null 2>&1; then fail "tampered InRelease"; fi
echo "tampered InRelease: BAD signature (expected)"

echo; echo "TEST-SIGN SMOKE PASS (throwaway keys; does NOT satisfy SAC / D-011)"
