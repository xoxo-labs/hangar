/// <reference types="vite/client" />

interface Window {
  hangarDesktop?: {
    chooseProjectDirectory: () => Promise<string | null>
  }
}
