import type { ExpoConfig } from "expo/config"

/**
 * A TS config (not app.json) so the networking decisions below can carry the
 * comments that explain them.
 */
const config: ExpoConfig = {
  name: "Hangar",
  slug: "hangar-mobile",
  version: "0.3.1",
  scheme: "hangar-mobile",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  // Generated from assets/hangar.svg by scripts/build-icons.mjs; iOS rounds the
  // square itself, so this one is full-bleed and opaque.
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "com.hangar.mobile",
    // The iPad build is the split layout's reason to exist; it also runs on
    // Apple Silicon Macs as "Designed for iPad".
    supportsTablet: true,
    infoPlist: {
      // The phone stays portrait (`orientation` above), an iPad turns. All four
      // are also what iPadOS asks of an app before it will let it into Split
      // View and Stage Manager — where the app is handed a slice of the screen
      // and, below 700 pt of it, goes back to the compact layout.
      "UISupportedInterfaceOrientations~ipad": [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
      // Paired machines speak plaintext http/ws on a LAN or Tailscale address,
      // so ATS has to stand aside: there is no certificate to pin on a Mac that
      // is just running a local server. Tailscale is the recommended transport
      // across networks — same note the desktop app shows next to the toggle.
      // No mDNS is involved (addresses come from the pairing code), so no
      // NSBonjourServices / NSLocalNetworkUsageDescription entries are needed.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
    },
  },
  android: {
    package: "com.hangar.mobile",
    // Launchers crop these two layers to their own shape and may parallax them,
    // which is why the mark ships apart from its plate. `monochromeImage` is the
    // Android 13 themed icon: one channel the system tints.
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundImage: "./assets/adaptive-icon-background.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
    },
  },
  plugins: [
    "expo-router",
    ["expo-camera", { cameraPermission: "Hangar uses the camera to scan the pairing QR code shown on your Mac." }],
  ],
}

export default config
