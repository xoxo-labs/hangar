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
  ios: {
    bundleIdentifier: "com.hangar.mobile",
    supportsTablet: true,
    infoPlist: {
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
  },
  plugins: [
    "expo-router",
    ["expo-camera", { cameraPermission: "Hangar uses the camera to scan the pairing QR code shown on your Mac." }],
  ],
}

export default config
