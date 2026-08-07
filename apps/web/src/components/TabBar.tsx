import * as actions from "../actions"
import { describe, toneOf } from "../status"
import { useStore } from "../store"
import { cx } from "../ui/cx"
import { Dot } from "./Dot"

export function TabBar() {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const openSettings = useStore((s) => s.openSettings)

  return (
    <div className="flex items-stretch gap-[2px] flex-none h-[34px] px-[6px] pt-[4px] bg-surface-3 border-b border-surface-5 overflow-hidden select-none electron:h-[48px] electron:pt-[14px] electron:[-webkit-app-region:drag]">
      <div
        className="flex items-stretch gap-[2px] flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {sessions.map((session) => {
          const active = session.id === activeId
          return (
            <div
              key={session.id}
              className={cx(
                "group flex items-center gap-[2px] flex-none max-w-[220px] pl-[8px] pr-[4px] rounded-t-[6px] electron:[-webkit-app-region:no-drag]",
                active
                  ? "bg-surface-1 text-surface-12 shadow-[0_1px_0_var(--color-surface-1)]"
                  : "text-surface-10 hover:bg-surface-a3",
              )}
              role="tab"
              aria-selected={active}
            >
              <button
                type="button"
                className="flex items-center gap-[7px] min-w-0 h-full text-inherit electron:[-webkit-app-region:no-drag]"
                title={session.cmd}
                onClick={() => setActive(session.id)}
              >
                <Dot tone={toneOf(session)} small title={describe(session)} />
                <span className="truncate text-[12px]">{session.id}</span>
              </button>
              <button
                type="button"
                className={cx(
                  "grid place-items-center w-[16px] h-[16px] rounded-[4px] text-surface-9 text-[13px] leading-none hover:bg-surface-a4 hover:text-surface-12 electron:[-webkit-app-region:no-drag]",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                title={session.status === "running" ? `Stop ${session.process}` : "Close session"}
                onClick={() =>
                  session.status === "running"
                    ? requestConfirm({
                        action: "stop-close",
                        project: session.project,
                        process: session.process,
                      })
                    : actions.close(session)
                }
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="z-[3] grid place-items-center flex-none self-center w-[34px] h-[30px] ml-[4px] bg-surface-3 border border-transparent rounded-[6px] text-surface-10 text-[18px] leading-none hover:bg-surface-a4 hover:border-surface-5 hover:text-surface-12 electron:-translate-y-[7px] electron:[-webkit-app-region:no-drag]"
        title="Settings (⌘,)"
        aria-label="Settings"
        onClick={openSettings}
      >
        ⚙
      </button>
    </div>
  )
}
