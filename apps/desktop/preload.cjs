const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("hangarDesktop", {
  chooseProjectDirectory: () => ipcRenderer.invoke("hangar:choose-project-directory"),
})
