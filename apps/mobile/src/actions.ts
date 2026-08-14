/**
 * Process actions. Call sites pass the scoped project name they already hold;
 * `routeOutbound` inside the manager strips the scope and picks the socket.
 * Destructive ones ask first, the way the desktop app does.
 */

import { displayName } from "@hangar/client-core"
import { Alert } from "react-native"
import { connections } from "./connections"

export function start(project: string, process?: string): void {
  connections().send({ type: "start", project, process })
}

export function stop(project: string, process?: string): void {
  confirmThen("Stop", project, process, () => connections().send({ type: "stop", project, process }))
}

export function restart(project: string, process?: string): void {
  confirmThen("Restart", project, process, () => connections().send({ type: "restart", project, process }))
}

function confirmThen(verb: "Stop" | "Restart", project: string, process: string | undefined, run: () => void): void {
  const target = process ?? `every process in ${displayName(project)}`
  Alert.alert(
    `${verb} ${target}?`,
    verb === "Stop" ? "The process will be shut down." : "The process will be restarted.",
    [
      { text: "Cancel", style: "cancel" },
      { text: verb, style: "destructive", onPress: run },
    ],
  )
}
