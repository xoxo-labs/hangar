import { connIdOf, displayName } from "@hangar/client-core"
import { sessionId, type ThemeSetting } from "@hangar/contracts"
import { Command } from "cmdk"
import { BookOpen, CircleHelp } from "lucide-react"
import { useMemo } from "react"
import * as actions from "../actions"
import { describe, toneOf } from "../status"
import { machineLabel, useStore } from "../store"
import { focusTerminal } from "../terminals"
import { Overlay } from "../ui/Dialog"
import { Dot } from "./Dot"
import { RESULT } from "./HistoryWorkspace"
import { type ProcessAction, processActions, resolveProcessAction } from "./processActions.logic"

/*
 * The panel mirrors Dialog's border/shadow instead of reusing <Dialog>: this
 * one is top-aligned and hosts cmdk's own root element, so wrapping it would
 * only add a second box around it. Overlay is reused as-is — its scrim and
 * mousedown-to-dismiss are exactly what a palette wants.
 */
const PANEL =
  "mt-[20vh] flex max-h-[calc(100vh-48px)] w-[min(560px,100%)] flex-col self-start overflow-hidden rounded-lg border border-surface-5 bg-surface-2 shadow-[0_18px_48px_#00000070]"

const INPUT =
  "w-full appearance-none border-0 border-b border-solid border-surface-5 bg-transparent px-3 py-2 text-md [font-family:inherit] text-surface-12 shadow-none outline-none placeholder:text-surface-8 focus:ring-0 focus:outline-none"

/* cmdk owns the group heading element, so it is reachable only through its data
 * attribute; styling it once on the list covers every group. */
const LIST =
  "max-h-[340px] overflow-y-auto p-1 " +
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 " +
  "[&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-caps " +
  "[&_[cmdk-group-heading]]:text-surface-9 [&_[cmdk-group-heading]]:uppercase"

const ITEM =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-base text-surface-11 data-[selected=true]:bg-surface-a4 data-[selected=true]:text-surface-12"

const GLYPH = "w-3 flex-none text-center text-surface-9"

/** Newest archived runs worth listing inline; the rest stay behind "All history…". */
const HISTORY_LIMIT = 20

/* Every run control names its process in full ("Stop web/dev", never "Stop"),
 * because search can put one next to another project's row of the same verb. */
const PROCESS_ACTION: Record<ProcessAction, { verb: string; glyph: string }> = {
  start: { verb: "Start", glyph: "▶" },
  restart: { verb: "Restart", glyph: "↻" },
  stop: { verb: "Stop", glyph: "■" },
}

const THEMES: Array<[ThemeSetting, string]> = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "System"],
]

/** Same short form the history tabs use, so a run reads identically in both places. */
const shortDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })

export function CommandPalette() {
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const history = useStore((s) => s.history)
  const settings = useStore((s) => s.settings)
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const openPending = useStore((s) => s.openPending)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const openEditor = useStore((s) => s.openEditor)
  const openHistory = useStore((s) => s.openHistory)
  const openHistoryRun = useStore((s) => s.openHistoryRun)
  const openReleaseNotes = useStore((s) => s.openReleaseNotes)
  const openSettings = useStore((s) => s.openSettings)
  const openHelp = useStore((s) => s.openHelp)
  const openTutorial = useStore((s) => s.openTutorial)
  const closePalette = useStore((s) => s.closePalette)
  const connections = useStore((s) => s.connections)

  /* cmdk keys every item by its `value`, and two machines can hold projects with
   * the same name — so with more than one machine the label goes into the value
   * (and into the row, so the duplicates are told apart on screen too). */
  const multi = Object.keys(connections).length > 1
  const machineOf = (scopedValue: string): string => {
    const connection = connections[connIdOf(scopedValue)]
    return connection === undefined ? "" : machineLabel(connection)
  }
  const tagged = (value: string, machine: string): string => (multi ? `${value} ${machine}` : value)
  const machineChip = (machine: string) =>
    multi ? <span className="ml-auto flex-none text-2xs text-surface-8">{machine}</span> : null

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  /* The store already keeps history newest-first, so the head of the list is
   * the most recent runs — no sorting, just a slice. */
  const recentRuns = history.slice(0, HISTORY_LIMIT)

  /** Every item closes first, so an action that opens a dialog keeps its focus. */
  const run = (action: () => void) => {
    closePalette()
    action()
  }

  /* The entries were rendered from a store slice that a WS message can replace
   * before Enter lands, so the process is looked at again here rather than
   * trusting the status it was drawn with. Both arguments stay scoped, as
   * everywhere else in the palette — `actions` strips the scope and routes the
   * message to the machine that owns the process. */
  const runProcessAction = (action: ProcessAction, project: string, process: string) => {
    const id = sessionId(project, process)
    const live = useStore.getState().sessions.find((session) => session.id === id)
    const resolved = resolveProcessAction(action, live?.status === "running")
    if (resolved === null) return
    // Stop and restart go through the same confirmation the sidebar uses.
    if (resolved === "start") actions.start(project, process)
    else requestConfirm({ action: resolved, project, process })
  }

  /* Leaving without picking anything hands the keyboard back to the terminal;
   * `run` deliberately does not, or it would steal focus from what it opened. */
  const dismiss = () => {
    closePalette()
    if (activeId !== null) focusTerminal(activeId)
  }

  return (
    <Overlay onDismiss={dismiss}>
      <Command
        label="Command palette"
        className={PANEL}
        onKeyDown={(event) => {
          if (event.key === "Escape") dismiss()
        }}
      >
        <Command.Input autoFocus className={INPUT} placeholder="Search projects, processes, actions…" />
        <Command.List className={LIST}>
          <Command.Empty className="px-3 py-6 text-center text-base text-surface-9">No results.</Command.Empty>

          {/* Jumping to a process is what the palette is opened for, so it leads.
              Both project-derived groups are gated on there being projects at all:
              cmdk only auto-hides an empty group while a search is running, so an
              empty registry would otherwise show two bare headings. */}
          {projects.length > 0 && (
            <Command.Group heading="Processes">
              {projects.flatMap((project) =>
                project.processes.map((proc) => {
                  const id = sessionId(project.name, proc.name)
                  const label = displayName(id)
                  const machine = machineOf(project.name)
                  const session = byId.get(id)
                  return (
                    <Command.Item
                      key={id}
                      value={tagged(label, machine)}
                      keywords={[displayName(project.name), proc.name, machine]}
                      className={ITEM}
                      onSelect={() => run(() => (session ? setActive(id) : openPending(project.name, proc.name)))}
                    >
                      <Dot tone={toneOf(session)} small title={describe(session)} />
                      <span className="truncate">{proc.name}</span>
                      <span className="truncate text-sm text-surface-9">{displayName(project.name)}</span>
                      {machineChip(machine)}
                    </Command.Item>
                  )
                }),
              )}
            </Command.Group>
          )}

          {projects.length > 0 && (
            <Command.Group heading="Actions">
              {projects.flatMap((project) => {
                const anyRunning = project.processes.some(
                  (p) => byId.get(sessionId(project.name, p.name))?.status === "running",
                )
                const machine = machineOf(project.name)
                const perProcess = project.processes.flatMap((proc) => {
                  const id = sessionId(project.name, proc.name)
                  const label = displayName(id)
                  const keywords = [displayName(project.name), proc.name, machine]
                  const running = byId.get(id)?.status === "running"
                  /* Rendered in the order processActions returns them: cmdk keeps
                   * DOM order when scores tie, which is what a query naming only
                   * the process does to every entry it has. */
                  return processActions(running).map((action) => (
                    <Command.Item
                      key={`${action} ${id}`}
                      value={tagged(`${action} ${label}`, machine)}
                      keywords={keywords}
                      className={ITEM}
                      onSelect={() => run(() => runProcessAction(action, project.name, proc.name))}
                    >
                      <span className={GLYPH} aria-hidden="true">
                        {PROCESS_ACTION[action].glyph}
                      </span>
                      {PROCESS_ACTION[action].verb} {label}
                      {machineChip(machine)}
                    </Command.Item>
                  ))
                })

                return [
                  ...perProcess,
                  <Command.Item
                    key={`start-all ${project.name}`}
                    value={tagged(`start all ${displayName(project.name)}`, machine)}
                    keywords={[displayName(project.name), machine]}
                    className={ITEM}
                    onSelect={() => run(() => actions.start(project.name))}
                  >
                    <span className={GLYPH} aria-hidden="true">
                      ▶
                    </span>
                    Start all in {displayName(project.name)}
                    {machineChip(machine)}
                  </Command.Item>,
                  ...(anyRunning
                    ? [
                        <Command.Item
                          key={`restart-all ${project.name}`}
                          value={tagged(`restart all ${displayName(project.name)}`, machine)}
                          keywords={[displayName(project.name), machine]}
                          className={ITEM}
                          onSelect={() => run(() => requestConfirm({ action: "restart", project: project.name }))}
                        >
                          <span className={GLYPH} aria-hidden="true">
                            ↻
                          </span>
                          Restart all in {displayName(project.name)}
                          {machineChip(machine)}
                        </Command.Item>,
                        <Command.Item
                          key={`stop-all ${project.name}`}
                          value={tagged(`stop all ${displayName(project.name)}`, machine)}
                          keywords={[displayName(project.name), machine]}
                          className={ITEM}
                          onSelect={() => run(() => requestConfirm({ action: "stop", project: project.name }))}
                        >
                          <span className={GLYPH} aria-hidden="true">
                            ■
                          </span>
                          Stop all in {displayName(project.name)}
                          {machineChip(machine)}
                        </Command.Item>,
                      ]
                    : []),
                ]
              })}
            </Command.Group>
          )}

          {/* Gated like the project groups: cmdk only auto-hides an empty group
              while a search is running, so an empty archive would leave a bare
              heading behind. */}
          {recentRuns.length > 0 && (
            <Command.Group heading="History">
              {recentRuns.map((entry) => {
                const result = RESULT[entry.reason]
                const date = shortDate(entry.startedAt)
                return (
                  <Command.Item
                    key={entry.runId}
                    value={`history ${displayName(entry.runId)}`}
                    keywords={[displayName(entry.project), entry.process, entry.reason, date, machineOf(entry.project)]}
                    className={ITEM}
                    onSelect={() => run(() => openHistoryRun(entry.runId))}
                  >
                    <span className={GLYPH} aria-hidden="true">
                      ◷
                    </span>
                    <span className="truncate">
                      {displayName(entry.project)}/{entry.process}
                    </span>
                    <span className="flex-none text-sm text-surface-9">
                      {date}{" "}
                      <span className={result.tone} title={result.label} aria-hidden="true">
                        {result.icon}
                      </span>
                    </span>
                  </Command.Item>
                )
              })}
              {history.length > recentRuns.length && (
                <Command.Item value="all history" className={ITEM} onSelect={() => run(openHistory)}>
                  <span className={GLYPH} aria-hidden="true">
                    ◷
                  </span>
                  All history…
                </Command.Item>
              )}
            </Command.Group>
          )}

          <Command.Group heading="Hangar">
            {/* Redundant once the History group lists the runs themselves, but with
                nothing archived the overview (and its "Enable history" prompt) would
                otherwise be unreachable from here. */}
            {recentRuns.length === 0 && (
              <Command.Item value="history" className={ITEM} onSelect={() => run(openHistory)}>
                <span className={GLYPH} aria-hidden="true">
                  ◷
                </span>
                History
              </Command.Item>
            )}
            <Command.Item value="release notes" className={ITEM} onSelect={() => run(openReleaseNotes)}>
              <span className={GLYPH} aria-hidden="true">
                ✦
              </span>
              Release notes
            </Command.Item>
            <Command.Item
              value="help shortcuts"
              keywords={["keyboard", "keys", "commands"]}
              className={ITEM}
              onSelect={() => run(openHelp)}
            >
              <CircleHelp className="size-3 flex-none text-surface-9" aria-hidden="true" />
              Help & keyboard shortcuts
            </Command.Item>
            <Command.Item
              value="tutorial"
              keywords={["tour", "welcome", "onboarding"]}
              className={ITEM}
              onSelect={() => run(openTutorial)}
            >
              <BookOpen className="size-3 flex-none text-surface-9" aria-hidden="true" />
              Tutorial
            </Command.Item>
            {THEMES.map(([theme, label]) => (
              <Command.Item
                key={`theme ${theme}`}
                value={`theme ${theme}`}
                keywords={["theme", "dark", "light", "appearance"]}
                className={ITEM}
                onSelect={() =>
                  run(() => actions.updateSettings({ ...settings, appearance: { ...settings.appearance, theme } }))
                }
              >
                <span className={GLYPH} aria-hidden="true">
                  ◐
                </span>
                Theme: {label}
                {settings.appearance.theme === theme && (
                  <span className="text-surface-9" aria-hidden="true">
                    ✓
                  </span>
                )}
              </Command.Item>
            ))}
            <Command.Item value="settings" className={ITEM} onSelect={() => run(openSettings)}>
              <span className={GLYPH} aria-hidden="true">
                ⚙
              </span>
              Settings
            </Command.Item>
            <Command.Item
              value="add project"
              keywords={["new", "folder", "import", "workspace", "monorepo"]}
              className={ITEM}
              onSelect={() => run(() => openEditor())}
            >
              <span className={GLYPH} aria-hidden="true">
                +
              </span>
              Add project…
            </Command.Item>
            {projects.map((project) => {
              const machine = machineOf(project.name)
              return (
                <Command.Item
                  key={`edit ${project.name}`}
                  value={tagged(`edit ${displayName(project.name)}`, machine)}
                  keywords={[displayName(project.name), machine]}
                  className={ITEM}
                  onSelect={() => run(() => openEditor(project.name))}
                >
                  <span className={GLYPH} aria-hidden="true">
                    ✎
                  </span>
                  Edit {displayName(project.name)}…{machineChip(machine)}
                </Command.Item>
              )
            })}
          </Command.Group>
        </Command.List>
      </Command>
    </Overlay>
  )
}
