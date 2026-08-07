import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@xterm/xterm/css/xterm.css"
import "./styles.css"
import { App } from "./App"
import { connect } from "./ws"

// Inside the Electron window the OS traffic lights float over the top-left
// corner and the frameless window needs a drag region — both handled in CSS
// behind this class, so the plain-browser experience stays untouched.
if (navigator.userAgent.includes("Electron")) {
  document.documentElement.classList.add("electron")
}

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")

connect()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
