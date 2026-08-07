import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@xterm/xterm/css/xterm.css"
import "./styles.css"
import { App } from "./App"
import { connect } from "./ws"

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")

connect()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
