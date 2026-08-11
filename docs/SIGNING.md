# Code signing & notarization

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
