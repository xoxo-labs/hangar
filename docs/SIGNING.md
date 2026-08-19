# Code signing & notarization

## Current status (2026-08-19)

The whole chain is verified and working. All five secrets are set, and a
`workflow_dispatch` run built, signed, notarized and stapled the app:
`codesign --verify --deep --strict` passes with the leaf authority
`Developer ID Application`, `xcrun stapler validate` finds the ticket, and
`spctl --assess --type execute` reports *accepted*. Pushing a `v*` tag now
produces a release users can open by double-clicking it.

The certificate is **ART EXECUTIVES SRL**, team `824CY78JVJ`, valid until
**2027-02-01** — short for a Developer ID, so renew well before that date.
Already-notarized builds keep working past expiry thanks to the secure
timestamp; what stops is the ability to sign new ones.

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

### Prove the credentials before CI does

Two failure modes cost three CI runs the first time around, and both will
be back at renewal. `gh secret set` accepts an **empty** value without
complaining — a `read` that consumed nothing leaves the secret defined and
blank — and `gh secret list` prints it identically to a real one, since it
only ever shows names and timestamps. The workflow's “Configure signing”
step now fails in seconds and names the empty secret, but it cannot see
inside a value that is merely *wrong*: a typo in `APPLE_ID` comes back from
notarytool as a generic `HTTP 401 Invalid credentials`, which reads like a
bad app-specific password and sends you re-minting the wrong secret.

Both are settled locally, before anything is pushed:

```sh
xcrun notarytool store-credentials hangar-notarize \
  --apple-id 'you@example.com' --team-id 824CY78JVJ
xcrun notarytool history --keychain-profile hangar-notarize
```

`store-credentials` validates the Apple ID / password / team triple as it
saves it, and `history` proves that account can actually reach the service.
Whatever that pair accepts is exactly what the three `APPLE_*` secrets must
contain — worth the thirty seconds, against a four-minute round trip
through CI that ends in the same 401 either way.

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
- The workflow's “Verify signature and notarization” step fails any signed
  build that would otherwise silently ship unsigned — on every run, not
  just on tags, so a `workflow_dispatch` proves the setup end to end.

## Auto-update transition note

Every release up to and including 0.5.0 is unsigned. Those installed
copies update to the first signed release via electron-updater;
Squirrel.Mac validates the *new* app's signature, which now passes
Gatekeeper properly. Still an untested hop — before tagging, serve a signed
build to an installed unsigned copy on one machine and watch it through
(`pnpm --filter @hangar/desktop mock-updates`, in
`apps/desktop/scripts/mock-update-server.mjs`), then keep an eye on the
first real rollout.
