import type { ConnectionConfig } from "@hangar/client-core"
import type { BrowseResult } from "@hangar/contracts"
import { CornerLeftUp, Folder, GitBranch, Package } from "lucide-react"
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import { authHeaders, serverOrigin } from "../links"
import { cx } from "../ui/cx"
import { appendSegment, canGoUp, compareBrowseEntries, leafPart, parentPath } from "./browsePath.logic"

/* Folders are listed by the machine that owns them, never by the browser: a
 * native picker can only ever see the Mac it opened on, which left every paired
 * machine, every phone and every headless Linux box typing paths blind. The
 * request goes to `config`, so the same component browses whichever machine the
 * project is being created on. */

/** Long enough that a held-down key does not fire a request per character,
 * short enough that the listing feels like it belongs to the keystroke. */
const DEBOUNCE_MS = 120

/**
 * A listing together with the path it was fetched for. The two must travel as
 * one: between a keystroke and its response the field already holds the new
 * path while the list still shows the old folder, and resolving an entry
 * against the typed path would then join a name to a parent it never belonged
 * to. Every read below goes through `path` here, so what is on screen and what
 * a pick resolves to are the same directory even mid-flight.
 */
type Listing = { path: string; result: BrowseResult }
const EMPTY: Listing = { path: "", result: { parent: "", prefix: "", entries: [], truncated: false } }

/** Lets the path input hand its arrow keys to the listing without the two
 * sharing state: the field keeps focus, the list keeps its own cursor. */
export type PathBrowserHandle = { handleKeyDown: (event: KeyboardEvent) => boolean }

type Props = {
  config: ConnectionConfig
  path: string
  onPick: (path: string) => void
  ref?: RefObject<PathBrowserHandle | null>
  className?: string
}

export function PathBrowser({ config, path, onPick, ref, className }: Props) {
  const [listing, setListing] = useState<Listing>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  const origin = serverOrigin(config)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      fetch(`${origin}/browse?path=${encodeURIComponent(path)}`, {
        headers: authHeaders(config),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not list folders")
          return response.json() as Promise<BrowseResult>
        })
        .then((value) => {
          setListing({ path, result: value })
          setError(null)
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return
          // A machine that went offline mid-type should say so rather than look empty.
          setListing({ path, result: EMPTY.result })
          setError(cause instanceof Error ? cause.message : "Could not list folders")
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [origin, config, path])

  // Everything below reads the listing's own path, never the typed one — see `Listing`.
  const shown = listing.path
  // Project-looking folders float to the top; the prefix already decided which rows are here at all.
  const entries = useMemo(() => [...listing.result.entries].sort(compareBrowseEntries), [listing.result.entries])
  const up = canGoUp(shown) ? parentPath(shown) : null
  const rows = up === null ? entries.length : entries.length + 1

  // A fresh listing invalidates whatever row was highlighted under the old one.
  useEffect(() => setActive(-1), [listing])

  useEffect(() => {
    if (active < 0) return
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  const pickRow = (index: number): void => {
    if (up !== null && index === 0) {
      onPick(up)
      return
    }
    const entry = entries[up === null ? index : index - 1]
    if (entry !== undefined) onPick(appendSegment(shown, entry.name))
  }

  useImperativeHandle(
    ref,
    () => ({
      handleKeyDown: (event: KeyboardEvent): boolean => {
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setActive((current) => (rows === 0 ? -1 : (current + 1) % rows))
          return true
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          setActive((current) => (rows === 0 ? -1 : (current <= 0 ? rows : current) - 1))
          return true
        }
        // ⌘↵ belongs to the dialog's save; only a bare ↵ descends into a row.
        if (event.key === "Enter" && active >= 0 && !event.metaKey && !event.ctrlKey) {
          event.preventDefault()
          pickRow(active)
          return true
        }
        // Shell-style completion. Tab keeps its normal job whenever it would do nothing
        // here, so the dialog's focus order stays reachable.
        if (event.key === "Tab" && !event.shiftKey && entries.length > 0) {
          const completion = commonPrefix(entries.map((entry) => entry.name))
          if (completion.length > leafPart(shown).length) {
            event.preventDefault()
            const completed = appendSegment(shown, completion)
            // Only an unambiguous match earns the trailing separator that descends into it.
            onPick(entries.length === 1 ? completed : completed.slice(0, -1))
            return true
          }
        }
        return false
      },
    }),
    // pickRow closes over `entries`, `up` and `shown`, so the handle is rebuilt with them.
    [active, entries, shown, rows, up],
  )

  return (
    <div className={cx("w-full", className)}>
      <div
        ref={listRef}
        // mousedown, not click: the input must not lose focus before the pick lands.
        onMouseDown={(event) => event.preventDefault()}
        className="max-h-[210px] w-full overflow-y-auto rounded-md border border-surface-5 bg-surface-1"
      >
        {up !== null && (
          <Row index={0} active={active === 0} onPick={pickRow}>
            <CornerLeftUp size={13} className="flex-none text-surface-9" />
            <span className="truncate text-sm text-surface-10">..</span>
          </Row>
        )}
        {entries.map((entry, index) => {
          const row = up === null ? index : index + 1
          return (
            <Row key={entry.path} index={row} active={active === row} onPick={pickRow}>
              <Folder size={13} className="flex-none text-surface-9" />
              <span className="truncate text-sm text-surface-12">{entry.name}</span>
              <span className="ml-auto flex flex-none items-center gap-1.5 text-surface-8">
                {entry.git && <GitBranch size={12} aria-label="git repository" />}
                {entry.pkg && <Package size={12} aria-label="has package.json" />}
              </span>
            </Row>
          )
        })}
        {rows === 0 && (
          <p className="px-2 py-2.5 text-sm text-surface-9">
            {error ?? (loading ? "Listing folders…" : "No folders here")}
          </p>
        )}
      </div>
      {(listing.result.truncated || error !== null) && (
        <span className="mt-1 block text-xs text-surface-9">
          {error ?? "Showing the first 500 folders — type more to narrow the list."}
        </span>
      )}
    </div>
  )
}

function Row({
  index,
  active,
  onPick,
  children,
}: {
  index: number
  active: boolean
  onPick: (index: number) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-row={index}
      // The path input keeps focus throughout; rows are reached with the arrow keys.
      tabIndex={-1}
      onClick={() => onPick(index)}
      className={cx(
        "flex min-h-[28px] w-full items-center gap-2 border-b border-surface-4 px-[7px] py-[3px] text-left last:border-b-0",
        active ? "bg-accent-a3" : "hover:bg-surface-a2",
      )}
    >
      {children}
    </button>
  )
}

/** The longest prefix every candidate shares, which is how far a completion can go unambiguously. */
function commonPrefix(names: string[]): string {
  if (names.length === 0) return ""
  let prefix = names[0] ?? ""
  for (const name of names.slice(1)) {
    let index = 0
    while (index < prefix.length && index < name.length && prefix[index] === name[index]) index += 1
    prefix = prefix.slice(0, index)
  }
  return prefix
}
