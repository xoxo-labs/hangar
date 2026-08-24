import { useState, type ReactNode } from "react"
import { cx } from "../ui/cx"
import { TextInput } from "../ui/Field"
import type { PackageInfo } from "../hooks/useProjectInfo"
import {
  filterPackageScripts,
  groupPackageScripts,
  type PackageScript,
  SCRIPT_FILTER_THRESHOLD,
} from "./packageScripts.logic"

const ELLIPSIS = "overflow-hidden text-ellipsis whitespace-nowrap"
const ADD_BUTTON =
  "py-[3px] text-base text-surface-10 enabled:hover:text-accent-9 disabled:cursor-default disabled:text-surface-7"

/**
 * The detected-scripts picker shared by the project editor and the Add-process
 * dialog: package.json scripts grouped by workspace, a filter once the list
 * outgrows scanning, one Add per row. The filter is local state, so callers
 * key this component by folder to reset it when the folder changes.
 */
export function DetectedScripts({
  pkg,
  addedNames,
  onAdd,
  placeholder,
}: {
  pkg: PackageInfo | null
  /** Process names already taken; their rows read "Added" and disable. */
  addedNames: Set<string>
  onAdd: (script: PackageScript) => void
  /** Shown inside the list box while there are no scripts to offer. */
  placeholder?: ReactNode
}) {
  const [query, setQuery] = useState("")
  const scripts = pkg?.scripts ?? []
  // A monorepo cumulates root plus every workspace's scripts, which is where a list stops being scannable.
  const filterable = scripts.length > SCRIPT_FILTER_THRESHOLD
  const shown = filterable ? filterPackageScripts(scripts, query) : scripts

  return (
    <div className="flex w-full flex-col items-start gap-[5px]">
      <span className="text-sm tracking-label text-surface-10">
        {pkg
          ? pkg.workspaceScriptCount
            ? `Monorepo scripts · ${pkg.manager}`
            : `package.json scripts · ${pkg.manager}`
          : "Detected scripts"}
      </span>
      {filterable && (
        <TextInput
          // Deliberately not autofocused: both dialogs start their focus flow elsewhere.
          className="py-1 text-sm"
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder="Filter scripts…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Escape is swallowed only when it clears something; otherwise it still closes the dialog.
            if (event.key !== "Escape" || query === "") return
            event.stopPropagation()
            setQuery("")
          }}
        />
      )}
      <div className="max-h-[240px] w-full overflow-y-auto rounded-md border border-surface-5 bg-surface-1">
        {scripts.length === 0 && placeholder !== undefined && (
          <p className="px-2 py-2.5 text-sm text-surface-9">{placeholder}</p>
        )}
        {scripts.length > 0 && shown.length === 0 && (
          <p className="px-2 py-2.5 text-sm text-surface-9">No matching scripts</p>
        )}
        {groupPackageScripts(shown).map((group) => (
          <section key={group.label}>
            <div className="sticky top-0 z-[1] flex items-center border-b border-surface-5 bg-surface-2 px-2 py-1 text-2xs font-semibold tracking-caps text-surface-9 uppercase">
              <span className="truncate">{group.label}</span>
              <span className="ml-auto font-normal tabular-nums text-surface-8">{group.scripts.length}</span>
            </div>
            {group.scripts.map((script) => {
              const added = addedNames.has(script.name)
              const label = script.workspace ? script.name.slice(script.workspace.length + 1) : script.name
              return (
                <div
                  key={script.name}
                  /* An already-added script dims as a whole row: the quiet "Added"
                   * label alone read as one more thing to click. */
                  className={cx(
                    "grid min-h-[28px] grid-cols-[minmax(70px,0.7fr)_minmax(120px,2fr)_42px] items-center gap-2 border-b border-surface-4 px-[7px] py-[3px] last:border-b-0",
                    added && "opacity-45",
                  )}
                  title={added ? `${script.name} is already a process` : `${script.name}: ${script.value}`}
                >
                  {/* The name is a label, not code — only the command earns monospace. */}
                  <span className={cx(ELLIPSIS, "text-sm text-surface-12")}>{label}</span>
                  <span className={cx(ELLIPSIS, "font-mono text-xs text-surface-9")}>{script.value}</span>
                  <button
                    type="button"
                    className={cx(ADD_BUTTON, "justify-self-end")}
                    disabled={added}
                    onClick={() => onAdd(script)}
                  >
                    {added ? "Added" : "+ Add"}
                  </button>
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}
