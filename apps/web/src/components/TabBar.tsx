import { displayName } from "@hangar/client-core"
import { PanelRight } from "lucide-react"
import { type DragEvent, type ReactNode, useState } from "react"
import * as actions from "../actions"
import { describe, toneOf } from "../status"
import { useStore } from "../store"
import { cx } from "../ui/cx"
import { Dot } from "./Dot"

const TAB =
  "group flex flex-none items-center gap-[2px] rounded-t-md pr-[4px] pl-[8px] electron:[-webkit-app-region:no-drag]"

function DraggableTab({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  const reorderTab = useStore((s) => s.reorderTab)
  const [dragging, setDragging] = useState(false)
  return (
    <div
      draggable
      className={cx("flex flex-none", dragging && "opacity-50")}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("application/x-hangar-tab", tabKey)
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-hangar-tab")) {
          event.preventDefault()
          event.dataTransfer.dropEffect = "move"
        }
      }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        const source = event.dataTransfer.getData("application/x-hangar-tab")
        if (source) reorderTab(source, tabKey)
      }}
    >
      {children}
    </div>
  )
}

export function TabBar() {
  const sessions = useStore((s) => s.sessions)
  const pending = useStore((s) => s.pending)
  const activeId = useStore((s) => s.activeId)
  const activeHistory = useStore((s) => s.activeHistory)
  const history = useStore((s) => s.history)
  const historyOpen = useStore((s) => s.historyOpen)
  const historyTabs = useStore((s) => s.historyTabs)
  const releaseNotesOpen = useStore((s) => s.releaseNotesOpen)
  const releaseNotesActive = useStore((s) => s.releaseNotesActive)
  const tabOrder = useStore((s) => s.tabOrder)
  const setActive = useStore((s) => s.setActive)
  const closePending = useStore((s) => s.closePending)
  const openHistory = useStore((s) => s.openHistory)
  const closeHistory = useStore((s) => s.closeHistory)
  const openHistoryRun = useStore((s) => s.openHistoryRun)
  const closeHistoryRun = useStore((s) => s.closeHistoryRun)
  const openReleaseNotes = useStore((s) => s.openReleaseNotes)
  const closeReleaseNotes = useStore((s) => s.closeReleaseNotes)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const inspectingId = useStore((s) => s.inspectingId)
  const toggleInspector = useStore((s) => s.toggleInspector)

  const activeTarget =
    activeHistory === null && !releaseNotesActive
      ? (sessions.find((session) => session.id === activeId) ?? pending.find((tab) => tab.id === activeId))
      : undefined
  const inspectorOpen = activeTarget !== undefined && inspectingId === activeTarget.id
  const sessionByKey = new Map(sessions.map((session) => [`session:${session.id}`, session]))
  /* Pending tabs share the `session:` key space on purpose: when the process
   * finally starts, the live tab inherits the slot instead of jumping to the end. */
  const pendingByKey = new Map(pending.map((tab) => [`session:${tab.id}`, tab]))
  const visibleKeys = tabOrder.filter(
    (key) =>
      sessionByKey.has(key) ||
      pendingByKey.has(key) ||
      (key === "history" && historyOpen) ||
      (key === "release-notes" && releaseNotesOpen) ||
      (key.startsWith("history:") && historyTabs.includes(key.slice(8))),
  )

  return (
    <div className="flex h-[34px] flex-none items-stretch gap-[2px] overflow-hidden border-b border-surface-5 bg-surface-3 px-[6px] pt-[4px] select-none electron:h-[48px] electron:pt-[14px] electron:[-webkit-app-region:drag]">
      <div
        className="flex min-w-0 flex-1 items-stretch gap-[2px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {visibleKeys.map((key) => {
          const session = sessionByKey.get(key)
          if (session) {
            const active = session.id === activeId
            return (
              <DraggableTab key={key} tabKey={key}>
                <div
                  className={cx(
                    TAB,
                    "max-w-[220px]",
                    active ? "bg-surface-1 text-surface-12 shadow-hairline" : "text-surface-10 hover:bg-surface-a3",
                  )}
                  role="tab"
                  aria-selected={active}
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 items-center gap-[7px] text-inherit"
                    title={session.cmd}
                    onClick={() => setActive(session.id)}
                  >
                    <Dot tone={toneOf(session)} small title={describe(session)} />
                    <span className="truncate text-base">{displayName(session.id)}</span>
                    {session.status === "exited" && (
                      <span
                        className="flex-none rounded-sm bg-surface-a4 px-1 py-px text-2xs tabular-nums text-surface-9"
                        title={describe(session)}
                      >
                        {session.exitCode == null ? "exited" : `exit ${session.exitCode}`}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={cx(
                      "grid size-[16px] place-items-center rounded-sm text-[13px] leading-none text-surface-9 hover:bg-surface-a4 hover:text-surface-12",
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                    title={session.status === "running" ? `Stop ${session.process}` : "Close session"}
                    onClick={() =>
                      session.status === "running"
                        ? requestConfirm({ action: "stop-close", project: session.project, process: session.process })
                        : actions.close(session)
                    }
                  >
                    ×
                  </button>
                </div>
              </DraggableTab>
            )
          }
          const waiting = pendingByKey.get(key)
          if (waiting) {
            const active = waiting.id === activeId
            return (
              <DraggableTab key={key} tabKey={key}>
                <div
                  className={cx(
                    TAB,
                    "max-w-[220px]",
                    active ? "bg-surface-1 text-surface-12 shadow-hairline" : "text-surface-10 hover:bg-surface-a3",
                  )}
                  role="tab"
                  aria-selected={active}
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 items-center gap-[7px] text-inherit"
                    onClick={() => setActive(waiting.id)}
                  >
                    <Dot tone="idle" small title="not started" />
                    <span className="truncate text-base">{displayName(waiting.id)}</span>
                  </button>
                  <button
                    type="button"
                    className={cx(
                      "grid size-[16px] place-items-center rounded-sm text-[13px] leading-none text-surface-9 hover:bg-surface-a4 hover:text-surface-12",
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                    title="Close tab"
                    onClick={() => closePending(waiting.id)}
                  >
                    ×
                  </button>
                </div>
              </DraggableTab>
            )
          }
          if (key === "history") {
            const active = activeHistory === "overview"
            return (
              <DraggableTab key={key} tabKey={key}>
                <div
                  className={cx(
                    TAB,
                    "max-w-[190px]",
                    active ? "bg-surface-1 text-surface-12 shadow-hairline" : "text-surface-10 hover:bg-surface-a3",
                  )}
                  role="tab"
                  aria-selected={active}
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 items-center gap-[7px] text-inherit"
                    onClick={openHistory}
                  >
                    <span className="text-[13px] text-surface-9">◷</span>
                    <span className="truncate text-base">History</span>
                    {history.length > 0 && (
                      <span className="rounded-full bg-surface-a4 px-[5px] text-2xs tabular-nums text-surface-9">
                        {history.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={cx(
                      "grid size-[16px] place-items-center rounded-sm text-[13px] text-surface-9 hover:bg-surface-a4 hover:text-surface-12",
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                    title="Close History"
                    onClick={closeHistory}
                  >
                    ×
                  </button>
                </div>
              </DraggableTab>
            )
          }
          if (key === "release-notes") {
            return (
              <DraggableTab key={key} tabKey={key}>
                <div
                  className={cx(
                    TAB,
                    "max-w-[190px]",
                    releaseNotesActive
                      ? "bg-surface-1 text-surface-12 shadow-hairline"
                      : "text-surface-10 hover:bg-surface-a3",
                  )}
                  role="tab"
                  aria-selected={releaseNotesActive}
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 items-center gap-[7px] text-inherit"
                    onClick={openReleaseNotes}
                  >
                    <span className="text-surface-9">✦</span>
                    <span className="truncate text-base">Release notes</span>
                  </button>
                  <button
                    type="button"
                    className={cx(
                      "grid size-[16px] place-items-center rounded-sm text-[13px] text-surface-9 hover:bg-surface-a4 hover:text-surface-12",
                      releaseNotesActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                    title="Close release notes"
                    onClick={closeReleaseNotes}
                  >
                    ×
                  </button>
                </div>
              </DraggableTab>
            )
          }
          const runId = key.slice(8)
          const entry = history.find((item) => item.runId === runId)
          if (!entry) return null
          const active = activeHistory === runId
          return (
            <DraggableTab key={key} tabKey={key}>
              <div
                className={cx(
                  TAB,
                  "max-w-[220px]",
                  active ? "bg-surface-1 text-surface-12 shadow-hairline" : "text-surface-10 hover:bg-surface-a3",
                )}
                role="tab"
                aria-selected={active}
              >
                <button
                  type="button"
                  className="flex h-full min-w-0 items-center gap-[7px] text-inherit"
                  onClick={() => openHistoryRun(runId)}
                  title={`${displayName(entry.id)} · ${new Date(entry.startedAt).toLocaleString()}`}
                >
                  <span className="text-[11px] text-surface-8">◷</span>
                  <span className="truncate text-base">
                    {entry.process} ·{" "}
                    {new Date(entry.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </button>
                <button
                  type="button"
                  className={cx(
                    "grid size-[16px] place-items-center rounded-sm text-[13px] text-surface-9 hover:bg-surface-a4 hover:text-surface-12",
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                  title="Close historical run"
                  onClick={() => closeHistoryRun(runId)}
                >
                  ×
                </button>
              </div>
            </DraggableTab>
          )
        })}
      </div>
      <button
        type="button"
        className={cx(
          "z-[3] ml-[4px] grid h-[30px] w-[34px] flex-none place-items-center self-center rounded-md border text-[16px] leading-none electron:-translate-y-[7px] electron:[-webkit-app-region:no-drag]",
          inspectorOpen
            ? "border-accent-8 bg-accent-a3 text-accent-11"
            : "border-transparent bg-surface-3 text-surface-10 enabled:hover:border-surface-5 enabled:hover:bg-surface-a4 enabled:hover:text-surface-12 disabled:opacity-35",
        )}
        title="Toggle session inspector (⌘I)"
        data-shortcut-hint="I"
        data-shortcut-placement="inside-top-right"
        aria-label="Toggle session inspector"
        aria-pressed={inspectorOpen}
        disabled={activeTarget === undefined}
        onClick={() => activeTarget && toggleInspector(activeTarget.id)}
      >
        <PanelRight className="size-[17px]" aria-hidden="true" />
      </button>
    </div>
  )
}
