import { buildSidebarEntries, connIdOf, LOCAL_CONN_ID } from "@hangar/client-core"
import { Monitor, Server } from "lucide-react"
import { useMemo } from "react"
import { connectionOf, machineLabel, useStore } from "../store"
import { cx } from "../ui/cx"

/**
 * The machines a project lives on, as a dialog's left column — the same shape
 * Settings uses for its categories. A project the sidebar merged across
 * machines is really one registry entry per Mac; whichever dialog acts on it
 * picks the Mac here and works on that Mac's entry alone.
 */
export function MachineTabs({
  names,
  active,
  locked,
  onSelect,
}: {
  /** The scoped project names, one per machine, in connection order. */
  names: string[]
  active: string
  /** Why the other tabs are off limits right now, if they are. */
  locked?: string
  onSelect: (name: string) => void
}) {
  const connections = useStore((s) => s.connections)
  return (
    <aside className="flex w-[158px] flex-none flex-col border-r border-surface-4 bg-surface-2">
      <header className="flex min-h-[43px] flex-none items-center border-b border-surface-4 px-3.5">
        <h2 className="m-0 text-xs font-semibold tracking-caps text-surface-9 uppercase">Machine</h2>
      </header>
      <nav aria-label="Machines" className="flex flex-col gap-0.5 p-2">
        {names.map((name) => {
          const connId = connIdOf(name)
          const selected = name === active
          const Icon = connId === LOCAL_CONN_ID ? Monitor : Server
          return (
            <button
              key={name}
              type="button"
              aria-current={selected ? "page" : undefined}
              className={cx(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-base outline-none transition-colors",
                "focus-visible:shadow-[0_0_0_2px_var(--color-accent-a5)]",
                selected
                  ? "bg-accent-a4 font-book text-accent-11"
                  : "text-surface-10 enabled:hover:bg-surface-a3 enabled:hover:text-surface-12 disabled:text-surface-8",
              )}
              disabled={locked !== undefined && !selected}
              title={locked !== undefined && !selected ? locked : undefined}
              onClick={() => onSelect(name)}
            >
              <Icon className="size-[15px] flex-none" strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">{machineLabel(connectionOf(connections, connId))}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

/**
 * Every machine's copy of the project `name` belongs to, in connection order:
 * the parts of the sidebar entry it merged into, or just itself.
 */
export function useMachineNames(name: string): string[] {
  const projects = useStore((s) => s.projects)
  const connections = useStore((s) => s.connections)
  return useMemo(() => {
    const entry = buildSidebarEntries(Object.keys(connections), projects, "").find((item) =>
      item.parts.some((part) => part.project.name === name),
    )
    return entry === undefined ? [name] : entry.parts.map((part) => part.project.name)
  }, [connections, projects, name])
}
