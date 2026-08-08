const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("hangarDesktop", {
  appInfo: () => ipcRenderer.invoke("hangar:app-info"),
  onOpenSettings: (callback) => {
    const listener = () => callback()
    ipcRenderer.on("hangar:open-settings", listener)
    return () => ipcRenderer.removeListener("hangar:open-settings", listener)
  },
  chooseDirectory: (title) => ipcRenderer.invoke("hangar:choose-directory", title),
  openUrl: (url, browser) => ipcRenderer.invoke("hangar:open-url", url, browser),
  openPath: (path) => ipcRenderer.invoke("hangar:open-path", path),
  revealPath: (path) => ipcRenderer.invoke("hangar:reveal-path", path),
})
