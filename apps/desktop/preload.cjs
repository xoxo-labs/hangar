const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("hangarDesktop", {
  appInfo: () => ipcRenderer.invoke("hangar:app-info"),
  chooseDirectory: (title) => ipcRenderer.invoke("hangar:choose-directory", title),
  openUrl: (url, browser) => ipcRenderer.invoke("hangar:open-url", url, browser),
  openPath: (path) => ipcRenderer.invoke("hangar:open-path", path),
  revealPath: (path) => ipcRenderer.invoke("hangar:reveal-path", path),
})
