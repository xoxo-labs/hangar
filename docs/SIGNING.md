# Code signing & notarization

## Current status (2026-08-19)

The Developer ID Application certificate exists: **ART EXECUTIVES SRL**,
team `824CY78JVJ`, valid until **2027-02-01** (short for a Developer ID —
renew well before that date, and note that already-notarized builds keep
working past it thanks to the secure timestamp).

Signing is verified locally: `codesign --verify --deep --strict` passes,
the chain reaches Apple Root CA, hardened runtime is on, and `node-pty`'s
unpacked `pty.node` is signed. What is **not** yet in place is
notarization — `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` are still
missing, so `spctl` reports `rejected / source=Unnotarized Developer ID`.

Until those two secrets exist, **do not push a `v*` tag**: signing turns
on as soon as `MAC_CERT_P12_BASE64` is set, notarization is skipped for
lack of credentials, and the verify gate then fails the whole release on
`xcrun stapler validate`. Set all five, or none.

Release builds are Developer ID–signed, hardened-runtime, and notarized.
The CI workflow (`.github/workflows/release.yml`) does all of it; local
builds without a certificate still work — electron-builder skips signing
and notarization with a warning, so `pnpm package:mac` / `pnpm dist:mac`
stay usable for development.

## One-time setup

### 1. Create the Developer ID Application certificate

Requires the Account Holder (or an Admin granted Developer ID access) of
the Apple Developer team. Easiest path, on a Mac signed into that Apple ID:

Xcode → Settings → Accounts → select the team → Manage Certificates… →
“+” → **Developer ID Application**.

Alternatively via [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates)
with a CSR from Keychain Access (Certificate Assistant → Request a
Certificate From a Certificate Authority).

### 2. Export the certificate for CI

In Keychain Access, find “Developer ID Application: …”, expand it to
include its private key, select both, right-click → Export → `.p12`,
choose an export password. Then:

```sh
base64 -i DeveloperID.p12 | pbcopy
```

### 3. Notarization credentials

Notarization authenticates as an Apple ID with an app-specific password:

1. [account.apple.com](https://account.apple.com) → Sign-In and Security →
   App-Specific Passwords → create one (name it e.g. `hangar-notarize`).
2. The team ID is shown at
   [developer.apple.com/account](https://developer.apple.com/account)
   under Membership details.

### 4. GitHub repository secrets

| Secret | Value |
| --- | --- |
| `MAC_CERT_P12_BASE64` | base64 of the exported `.p12` (step 2) |
| `MAC_CERT_P12_PASSWORD` | the `.p12` export password |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password (step 3) |
| `APPLE_TEAM_ID` | 10-character team ID (step 3) |

Set them without the values ever reaching a shell history or a terminal
buffer — `gh secret set` reads stdin:

```sh
base64 -i DeveloperID.p12 | gh secret set MAC_CERT_P12_BASE64
printf %s '824CY78JVJ' | gh secret set APPLE_TEAM_ID
read -rs P && printf %s "$P" | gh secret set MAC_CERT_P12_PASSWORD
read -rs P && printf %s "$P" | gh secret set APPLE_APP_SPECIFIC_PASSWORD
read -r  A && printf %s "$A" | gh secret set APPLE_ID
```

## Checking the certificate without a build

Signing can be exercised locally straight from the `.p12`, with no
keychain import — electron-builder builds a throwaway keychain from
`CSC_LINK`:

```sh
CSC_LINK=/path/to/DeveloperID.p12 CSC_KEY_PASSWORD='…' pnpm package:mac
codesign --display --verbose=4 apps/desktop/release/mac-arm64/Hangar.app | grep Authority
```

Notarization is skipped in that run (`notarize` options unavailable), so
`spctl` will still reject the app — that is expected, and the only part
that CI can prove.

## How it hangs together

- `apps/desktop/package.json` → `build.mac`: `hardenedRuntime`,
  entitlements (`assets/entitlements.mac.plist`: JIT + unsigned executable
  memory, the standard Electron carve-outs), `notarize: true`.
- electron-builder signs every binary in the bundle (including
  `node-pty`'s unpacked native module), notarizes the app with the
  `APPLE_*` env credentials, and staples the ticket.
- The workflow's “Verify signature and notarization” step fails a tag
  build that would otherwise silently ship unsigned.

## Auto-update transition note

Installed copies from unsigned releases (≤ 0.3.1) update to the first
signed release via electron-updater; Squirrel.Mac validates the *new*
app's signature, which now passes Gatekeeper properly. Verify the hop on
one machine with `scripts/mock-update-server.mjs` before tagging, then
keep an eye on the first real rollout.
