/** Which run controls the command palette offers for a single process, and what
 * they should do once chosen. Split out of the palette because both rules are
 * about safety rather than layout — the palette is a fuzzy-search surface where
 * a mistyped query and a reflexive Enter can reach a running dev server — and
 * they are worth asserting without mounting cmdk. */

export type ProcessAction = "start" | "restart" | "stop"

/**
 * The entries worth offering for a process in its current state, best first.
 *
 * cmdk ranks by match score and keeps DOM order on a tie, and a query that only
 * names the process ties every entry for it — so listing Restart ahead of Stop
 * is what decides which one a blind Enter lands on. Start is offered only while
 * the process is idle, so it can never be the thing that shadows Stop.
 */
export function processActions(running: boolean): ProcessAction[] {
  return running ? ["restart", "stop"] : ["start"]
}

/**
 * What an entry should do, judged against the state at the moment it is chosen
 * rather than the state it was rendered from: the palette can sit open across a
 * WS update, and the process may have exited (or been started from another
 * machine) in between.
 *
 * `null` means the outcome has already happened. The server ignores a start for
 * a session it is already running, so the point is the other direction — a stop
 * confirmation for a process that has since exited is a dialog asking about
 * nothing, and answering it sends a stop for a pid that is gone.
 */
export function resolveProcessAction(action: ProcessAction, running: boolean): ProcessAction | null {
  if (action === "start") return running ? null : "start"
  if (action === "stop") return running ? "stop" : null
  // Restart holds either way: it starts an idle process instead of failing.
  return "restart"
}
