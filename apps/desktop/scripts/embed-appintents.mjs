// electron-builder afterPack hook: build the App Intents extension and put it
// inside Hangar.app, so Spotlight and Shortcuts talk to the app people install
// rather than to a dev host.
//
// It runs before electron-builder signs, which is the order codesign wants:
// nested code first, then the outer bundle seals it.
//
// Off unless HANGAR_EMBED_APPINTENTS=1. Signed distribution needs one thing
// this repo does not have yet — a Developer ID provisioning profile carrying
// the App Group — so a release that silently embedded an unprofiled extension
// would notarize and then fail to reach its container at runtime. Opting in is
// how that stays a decision instead of an accident.

import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const APPINTENTS = resolve(HERE, "../appintents")
const PROJECT = join(APPINTENTS, "HangarIntents.xcodeproj")
const SCHEME = "HangarIntents"

/** Where ExtensionKit looks; the appex is inert anywhere else in the bundle. */
const DESTINATION = "Contents/Extensions/HangarIntents.appex"

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options })
}

export default async function embedAppIntents(context) {
  if (process.env.HANGAR_EMBED_APPINTENTS !== "1") return
  if (context.electronPlatformName !== "darwin") return

  if (!existsSync(PROJECT)) {
    throw new Error(
      `${PROJECT} is missing — run: pnpm --filter @hangar/desktop appintents:generate && pnpm --filter @hangar/desktop appintents:project`,
    )
  }
  if (!process.env.HANGAR_TEAM_ID) {
    throw new Error("HANGAR_TEAM_ID is unset — the extension signs under the team that owns its App Group.")
  }

  const derived = join(APPINTENTS, "build")
  rmSync(derived, { recursive: true, force: true })

  // Signed inside this hook rather than by xcodebuild: the identity has to be
  // the one electron-builder uses for the app around it, and automatic signing
  // would reach for a provisioning profile the CI keychain has no reason to hold.
  run("xcodebuild", [
    "-project",
    PROJECT,
    "-scheme",
    SCHEME,
    "-configuration",
    "Release",
    "-destination",
    "platform=macOS",
    "-derivedDataPath",
    derived,
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ])

  const appex = join(derived, "Build/Products/Release/HangarIntents.appex")
  if (!existsSync(appex)) throw new Error(`xcodebuild reported success but ${appex} is missing`)

  const target = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, DESTINATION)
  mkdirSync(dirname(target), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  cpSync(appex, target, { recursive: true })

  // An App Group entitlement outside the App Store is only honoured if the
  // bundle carries a matching Developer ID profile. Notarization passes
  // without it and the container lookup then fails in the field, so this is
  // the difference between "ships" and "works".
  const profile = process.env.HANGAR_APPINTENTS_PROFILE
  if (profile) {
    cpSync(profile, join(target, "Contents/embedded.provisionprofile"))
  }

  // Always sign here, even locally. Leaving it to electron-builder is not the
  // neutral option: its signer walks the bundle and applies the *app's*
  // entitlements, which would hand the extension Electron's JIT carve-outs and
  // no App Group — an extension that launches and then cannot find its store.
  // mac.signIgnore keeps it from undoing this; the two must stay in step.
  const identity = process.env.CSC_NAME ?? "-"
  run("codesign", [
    "--force",
    "--sign",
    identity,
    "--options",
    "runtime",
    "--entitlements",
    join(APPINTENTS, "Generated/HangarIntents.entitlements"),
    // Ad-hoc signatures cannot carry one, and it needs Apple's timestamp server.
    ...(identity === "-" ? [] : ["--timestamp"]),
    target,
  ])
  console.log(`[hangar] embedded ${DESTINATION} signed by ${identity === "-" ? "ad-hoc" : identity}`)

  rmSync(derived, { recursive: true, force: true })
}
