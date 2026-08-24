import { connIdOf, LOCAL_CONN_ID, routeOutbound } from "@hangar/client-core"
import type { ClientMsg, ServerMsg } from "@hangar/contracts"
import { sendTo, startConnections } from "./connections/manager"
import { takeCloseOnExit, useStore } from "./store"
import {
  applyTerminalSettings,
  disposeTerminal,
  recordMetricPosition,
  resetMetricPositions,
  writeOutput,
  writeSnapshot,
} from "./terminals"
import { applyThemeSetting } from "./theme"

/** The tutorial decision waits for the local server's first state so it reads real settings, not defaults. */
let sawFirstState = false

/** Brings up every connection; the supervisors own reconnection from here on. */
export function connect(): void {
  startConnections(handle)
}

/** One connection's message, with every id already scoped by the manager. */
function handle(connId: string, msg: ServerMsg): void {
  const store = useStore.getState()
  switch (msg.type) {
    case "state": {
      const known = store.sessions.filter((session) => connIdOf(session.id) === connId)
      const gone = known.filter((session) => !msg.sessions.some((next) => next.id === session.id))
      const restarted = known.filter((session) =>
        msg.sessions.some((next) => next.id === session.id && next.runId !== session.runId),
      )
      store.applyState(connId, msg)
      for (const session of gone) disposeTerminal(session.id)
      for (const session of restarted) resetMetricPositions(session.id)
      // Theme, terminal appearance and onboarding are global UI: only the local
      // machine's settings drive them.
      if (connId !== LOCAL_CONN_ID) return
      applyThemeSetting(msg.settings.appearance.theme)
      applyTerminalSettings(msg.settings.terminal)
      if (!sawFirstState) {
        sawFirstState = true
        // `=== false` (not `!`): an older server that predates the onboarding
        // section sends nothing here, and that must not re-open the tour.
        if (msg.settings.onboarding?.tutorialSeen === false) store.openTutorial()
      }
      return
    }
    case "metrics":
      recordMetricPosition(msg.id, msg.metrics.sampledAt)
      store.updateMetrics(msg.id, msg.runId, msg.metrics)
      return
    case "snapshot":
      writeSnapshot(msg.id, msg.data)
      return
    case "output":
      writeOutput(msg.id, msg.data)
      return
    case "historyReplay":
      store.setHistoryReplay(msg.runId, msg.events, msg.truncated)
      return
    case "historyMetrics":
      store.setHistoryMetrics(msg.runId, msg.samples)
      return
    case "exit":
      // A "stop & close" confirmed from the tab finishes here, once the
      // session is actually dead and the server will accept the dismiss.
      if (takeCloseOnExit(msg.id)) send({ type: "dismiss", id: msg.id })
      return
    case "error":
      store.setError(msg.message)
      return
  }
}

/** Strips the scope off `msg` and hands it to the connection that owns it. */
export function send(msg: ClientMsg): void {
  for (const outbound of routeOutbound(msg)) sendTo(outbound.connId, outbound.msg)
}
