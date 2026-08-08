import { sessionId, type ThemeSetting } from "@hangar/contracts"
import { Command } from "cmdk"
import { BookOpen, CircleHelp } from "lucide-react"
import { useMemo } from "react"
import * as actions from "../actions"
import { describe, toneOf } from "../status"
import { useStore } from "../store"
import { focusTerminal } from "../terminals"
import { Overlay } from "../ui/Dialog"
import { Dot } from "./Dot"
import { RESULT } from "./HistoryWorkspace"

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

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  /* The store already keeps history newest-first, so the head of the list is
   * the most recent runs — no sorting, just a slice. */
  const recentRuns = history.slice(0, HISTORY_LIMIT)

  /** Every item closes first, so an action that opens a dialog keeps its focus. */
  const run = (action: () => void) => {
    closePalette()
    action()
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
                  const session = byId.get(id)
                  return (
                    <Command.Item
                      key={id}
                      value={id}
                      keywords={[project.name, proc.name]}
                      className={ITEM}
                      onSelect={() => run(() => (session ? setActive(id) : openPending(project.name, proc.name)))}
                    >
                      <Dot tone={toneOf(session)} small title={describe(session)} />
                      <span className="truncate">{proc.name}</span>
                      <span className="truncate text-sm text-surface-9">{project.name}</span>
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
                const perProcess = project.processes.flatMap((proc) => {
                  const id = sessionId(project.name, proc.name)
                  const keywords = [project.name, proc.name]
                  const running = byId.get(id)?.status === "running"
                  if (!running) {
                    return [
                      <Command.Item
                        key={`start ${id}`}
                        value={`start ${id}`}
                        keywords={keywords}
                        className={ITEM}
                        onSelect={() => run(() => actions.start(project.name, proc.name))}
                      >
                        <span className={GLYPH} aria-hidden="true">
                          ▶
                        </span>
                        Start {id}
                      </Command.Item>,
                    ]
                  }
                  return [
                    <Command.Item
                      key={`restart ${id}`}
                      value={`restart ${id}`}
                      keywords={keywords}
                      className={ITEM}
                      onSelect={() =>
                        run(() => requestConfirm({ action: "restart", project: project.name, process: proc.name }))
                      }
                    >
                      <span className={GLYPH} aria-hidden="true">
                        ↻
                      </span>
                      Restart {id}
                    </Command.Item>,
                    <Command.Item
                      key={`stop ${id}`}
                      value={`stop ${id}`}
                      keywords={keywords}
                      className={ITEM}
                      onSelect={() =>
                        run(() => requestConfirm({ action: "stop", project: project.name, process: proc.name }))
                      }
                    >
                      <span className={GLYPH} aria-hidden="true">
                        ■
                      </span>
                      Stop {id}
                    </Command.Item>,
                  ]
                })

                return [
                  ...perProcess,
                  <Command.Item
                    key={`start-all ${project.name}`}
                    value={`start all ${project.name}`}
                    keywords={[project.name]}
                    className={ITEM}
                    onSelect={() => run(() => actions.start(project.name))}
                  >
                    <span className={GLYPH} aria-hidden="true">
                      ▶
                    </span>
                    Start all in {project.name}
                  </Command.Item>,
                  ...(anyRunning
                    ? [
                        <Command.Item
                          key={`restart-all ${project.name}`}
                          value={`restart all ${project.name}`}
                          keywords={[project.name]}
                          className={ITEM}
                          onSelect={() => run(() => requestConfirm({ action: "restart", project: project.name }))}
                        >
                          <span className={GLYPH} aria-hidden="true">
                            ↻
                          </span>
                          Restart all in {project.name}
                        </Command.Item>,
                        <Command.Item
                          key={`stop-all ${project.name}`}
                          value={`stop all ${project.name}`}
                          keywords={[project.name]}
                          className={ITEM}
                          onSelect={() => run(() => requestConfirm({ action: "stop", project: project.name }))}
                        >
                          <span className={GLYPH} aria-hidden="true">
                            ■
                          </span>
                          Stop all in {project.name}
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
                    value={`history ${entry.runId}`}
                    keywords={[entry.project, entry.process, entry.reason, date]}
                    className={ITEM}
                    onSelect={() => run(() => openHistoryRun(entry.runId))}
                  >
                    <span className={GLYPH} aria-hidden="true">
                      ◷
                    </span>
                    <span className="truncate">
                      {entry.project}/{entry.process}
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
            {projects.map((project) => (
              <Command.Item
                key={`edit ${project.name}`}
                value={`edit ${project.name}`}
                keywords={[project.name]}
                className={ITEM}
                onSelect={() => run(() => openEditor(project.name))}
              >
                <span className={GLYPH} aria-hidden="true">
                  ✎
                </span>
                Edit {project.name}…
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </Overlay>
  )
}
