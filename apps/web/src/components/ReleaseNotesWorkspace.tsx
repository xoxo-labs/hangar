import { useEffect, useState } from "react"

export function ReleaseNotesWorkspace() {
  const [info, setInfo] = useState<{ version: string; releaseNotes: string } | null>(null)

  useEffect(() => {
    if (window.hangarDesktop) {
      void window.hangarDesktop.appInfo().then(setInfo)
    } else {
      setInfo({
        version: "development",
        releaseNotes: "# Hangar\n\nRelease notes are available in the desktop application.",
      })
    }
  }, [])

  const lines = (info?.releaseNotes ?? "Loading release notes…").split("\n")
  return (
    <div className="absolute inset-0 overflow-y-auto bg-surface-1">
      <article className="mx-auto w-full max-w-[780px] px-[36px] py-[32px]">
        <div className="mb-[24px] flex items-start justify-between gap-4 border-b border-surface-5 pb-[20px]">
          <div>
            <p className="m-0 text-xs font-semibold tracking-caps text-surface-8 uppercase">What’s new</p>
            <h2 className="mt-[5px] mb-0 text-2xl font-strong">Release notes</h2>
          </div>
          <span className="text-sm tabular-nums text-surface-9">v{info?.version ?? "…"}</span>
        </div>
        <div className="text-base leading-relaxed text-surface-10">
          {lines.map((line, index) =>
            line.startsWith("# ") ? (
              <h3 key={index} className="mt-[22px] mb-[8px] text-xl font-strong text-surface-12">
                {line.slice(2)}
              </h3>
            ) : line.startsWith("## ") ? (
              <h4 key={index} className="mt-[20px] mb-[7px] text-md font-semibold text-surface-12">
                {line.slice(3)}
              </h4>
            ) : line.startsWith("- ") ? (
              <div key={index} className="my-[5px] flex gap-[9px]">
                <span className="text-accent-10">•</span>
                <span>{line.slice(2)}</span>
              </div>
            ) : line ? (
              <p key={index} className="my-[8px]">
                {line}
              </p>
            ) : null,
          )}
        </div>
      </article>
    </div>
  )
}
