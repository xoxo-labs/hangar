/// <reference types="vite/client" />

import type { BrowserChoice, DesktopUpdateState } from "@hangar/contracts"

declare global {
  interface Window {
    hangarDesktop?: {
      appInfo: () => Promise<{ version: string; releaseNotes: string }>
      openReleaseNotes: () => Promise<void>
      openShortcuts: () => Promise<void>
      onOpenSettings: (callback: () => void) => () => void
      onOpenHelp: (callback: () => void) => () => void
      chooseDirectory: (title?: string) => Promise<string | null>
      updateState: () => Promise<DesktopUpdateState>
      checkForUpdate: () => Promise<DesktopUpdateState>
      downloadUpdate: () => Promise<DesktopUpdateState>
      installUpdate: () => Promise<DesktopUpdateState>
      onUpdateState: (callback: (state: DesktopUpdateState) => void) => () => void
      openUrl: (url: string, browser: BrowserChoice) => Promise<string>
      openPath: (path: string) => Promise<string>
      revealPath: (path: string) => Promise<void>
    }
  }
}
