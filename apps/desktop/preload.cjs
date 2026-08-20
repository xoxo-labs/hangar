const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("hangarDesktop", {
  appInfo: () => ipcRenderer.invoke("hangar:app-info"),
  openReleaseNotes: () => ipcRenderer.invoke("hangar:open-release-notes"),
  openShortcuts: () => ipcRenderer.invoke("hangar:open-shortcuts"),
  onOpenSettings: (callback) => {
    const listener = () => callback()
    ipcRenderer.on("hangar:open-settings", listener)
    return () => ipcRenderer.removeListener("hangar:open-settings", listener)
  },
  onOpenHelp: (callback) => {
    const listener = () => callback()
    ipcRenderer.on("hangar:open-help", listener)
    return () => ipcRenderer.removeListener("hangar:open-help", listener)
  },
  onOpenTutorial: (callback) => {
    const listener = () => callback()
    ipcRenderer.on("hangar:open-tutorial", listener)
    return () => ipcRenderer.removeListener("hangar:open-tutorial", listener)
  },
  // A link that arrived before this renderer existed waits in the main process;
  // the push below only reaches a window that is already up.
  takeDeepLink: () => ipcRenderer.invoke("hangar:take-deep-link"),
  onDeepLink: (callback) => {
    const listener = (_event, url) => callback(url)
    ipcRenderer.on("hangar:deep-link", listener)
    return () => ipcRenderer.removeListener("hangar:deep-link", listener)
  },
  chooseDirectory: (title) => ipcRenderer.invoke("hangar:choose-directory", title),
  updateState: () => ipcRenderer.invoke("hangar:update-state"),
  checkForUpdate: () => ipcRenderer.invoke("hangar:update-check"),
  downloadUpdate: () => ipcRenderer.invoke("hangar:update-download"),
  installUpdate: () => ipcRenderer.invoke("hangar:update-install"),
  onCheckUpdates: (callback) => {
    const listener = () => callback()
    ipcRenderer.on("hangar:check-updates", listener)
    return () => ipcRenderer.removeListener("hangar:check-updates", listener)
  },
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on("hangar:update-state", listener)
    return () => ipcRenderer.removeListener("hangar:update-state", listener)
  },
  openUrl: (url, browser) => ipcRenderer.invoke("hangar:open-url", url, browser),
  openPath: (path) => ipcRenderer.invoke("hangar:open-path", path),
  revealPath: (path) => ipcRenderer.invoke("hangar:reveal-path", path),
})
