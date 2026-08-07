/// <reference types="vite/client" />

import type { BrowserChoice } from "@hangar/contracts"

declare global {
interface Window {
  hangarDesktop?: {
    appInfo: () => Promise<{ version: string; releaseNotes: string }>
    chooseDirectory: (title?: string) => Promise<string | null>
    openUrl: (url: string, browser: BrowserChoice) => Promise<string>
    openPath: (path: string) => Promise<string>
    revealPath: (path: string) => Promise<void>
  }
}
}
