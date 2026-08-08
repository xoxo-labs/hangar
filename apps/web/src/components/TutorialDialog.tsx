import { Copy, ExternalLink, Folder, Play, Search } from "lucide-react"
import { useState, type KeyboardEvent, type ReactNode } from "react"
import * as actions from "../actions"
import { useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogFooter, Overlay } from "../ui/Dialog"

/*
 * The first-run tour. It opens once, on the first server state whose settings
 * still have `onboarding.tutorialSeen` unset (see ws.ts), and again on demand
 * from Settings → About or the ⌘K palette. Leaving it in any way — Skip, Done,
 * Escape, clicking the scrim — marks it seen, so it never nags twice.
 *
 * Each step carries a small schematic built from the app's own tokens instead
 * of screenshots: screenshots rot, and the schematic reads in both themes.
 */

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-sm border border-surface-6 bg-surface-a3 px-1 font-mono text-xs text-surface-11">
      {children}
    </kbd>
  )
}

/** Shared stage for the step schematics; decorative, so hidden from readers. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" className="grid h-[108px] place-items-center overflow-hidden rounded-lg border border-surface-5 bg-surface-1 select-none">
      {children}
    </div>
  )
}

function MockRow({ name, running = false }: { name: string; running?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs text-surface-11">
      <span className={cx("size-[5px] flex-none rounded-full", running ? "bg-success-10" : "bg-surface-8")} />
      {name}
      {!running && <Play size={9} className="ml-auto text-surface-9" />}
    </div>
  )
}

/** A folder becoming a project group: opened in place, never cloned. */
function MockProjects() {
  return (
    <Frame>
      <div className="flex items-center gap-2.5">
        <span className="flex items-center gap-1.5 rounded-md border border-surface-5 bg-surface-a3 px-2 py-1 font-mono text-xs text-surface-10">
          <Folder size={11} /> ~/code/app
        </span>
        <span className="text-sm text-surface-8">→</span>
        <div className="w-[136px] rounded-md border border-surface-5 bg-surface-2 p-1.5">
          <div className="flex items-center justify-between px-1 pb-1 text-xs font-semibold text-surface-10">
            app <span className="text-2xs font-normal text-surface-8">2/3</span>
          </div>
          <MockRow name="web" running />
          <MockRow name="api" running />
          <MockRow name="db" />
        </div>
      </div>
    </Frame>
  )
}

const CPU_BARS = [12, 16, 14, 22, 30, 26, 44, 68, 86, 93]
const MEM_BARS = [38, 40, 41, 45, 44, 47, 49, 50, 52, 51]

function MetricCard({ label, value, bars, hot = false }: { label: string; value: string; bars: number[]; hot?: boolean }) {
  return (
    <div className="w-[120px] rounded-md border border-surface-5 bg-surface-2 p-2">
      <div className="flex items-baseline justify-between">
        <span className="text-2xs font-semibold tracking-caps text-surface-9 uppercase">{label}</span>
        <span className={cx("font-mono text-xs", hot ? "text-warning-10" : "text-surface-11")}>{value}</span>
      </div>
      <div className="mt-1.5 flex h-6 items-end gap-[2px]">
        {bars.map((height, index) => (
          <span
            key={index}
            className={cx("flex-1 rounded-[1px]", hot && height > 60 ? "bg-warning-10" : "bg-surface-7")}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  )
}

function MockMetrics() {
  return (
    <Frame>
      <div className="flex gap-2.5">
        <MetricCard label="CPU" value="93%" bars={CPU_BARS} hot />
        <MetricCard label="Memory" value="412 MB" bars={MEM_BARS} />
      </div>
    </Frame>
  )
}

const SYNC_BARS = [22, 30, 26, 74, 34, 28, 38, 30]

/** A chart point and the output line it maps to, cross-linked both ways. */
function MockSync() {
  return (
    <Frame>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-[92px] items-end gap-[3px] rounded-md border border-surface-5 bg-surface-2 p-1.5">
          {SYNC_BARS.map((height, index) => (
            <span
              key={index}
              className={cx("flex-1 rounded-[1px]", index === 3 ? "bg-accent-9" : "bg-surface-7")}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <span className="text-sm text-surface-8">⇄</span>
        <div className="w-[150px] rounded-md border border-surface-5 bg-surface-2 p-1.5 font-mono text-2xs leading-relaxed text-surface-9">
          <p className="m-0 truncate">ready in 812 ms</p>
          <p className="m-0 -mx-1.5 truncate border-l-2 border-accent-9 bg-surface-a3 px-1.5 text-surface-11">compiling /app…</p>
          <p className="m-0 truncate">✓ compiled in 4.2 s</p>
        </div>
      </div>
    </Frame>
  )
}

function MockPorts() {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded-md border border-surface-5 bg-surface-a3 px-2 py-0.5 font-mono text-xs text-surface-12">:3000</span>
          <ExternalLink size={11} className="text-surface-9" />
          <Copy size={11} className="text-surface-9" />
        </div>
        <div className="flex gap-3 font-mono text-2xs text-surface-9">
          <span>Local · 127.0.0.1</span>
          <span>LAN · 192.168.1.24</span>
          <span>Tailscale · 100.84.3.7</span>
        </div>
      </div>
    </Frame>
  )
}

function MockPalette() {
  return (
    <Frame>
      <div className="w-[200px] overflow-hidden rounded-md border border-surface-5 bg-surface-2">
        <div className="flex items-center gap-1.5 border-b border-surface-5 px-2 py-1.5 text-xs text-surface-8">
          <Search size={10} />
          Search…
          <kbd className="ml-auto rounded-sm border border-surface-6 bg-surface-a3 px-1 font-mono text-2xs text-surface-10">⌘K</kbd>
        </div>
        <div className="p-1 text-xs text-surface-11">
          <p className="m-0 rounded-sm bg-surface-a4 px-1.5 py-0.5">▶ Start app/web</p>
          <p className="m-0 px-1.5 py-0.5 text-surface-9">◷ web · yesterday</p>
        </div>
      </div>
    </Frame>
  )
}

const STEPS = [
  {
    title: "Open a folder, get a project",
    body: (
      <>
        Point hangar at a folder that&apos;s already on your Mac — nothing is cloned or copied. Its{" "}
        <code>package.json</code> scripts become processes; clicking one opens its tab, and ▶ is
        what starts it.
      </>
    ),
    visual: <MockProjects />,
  },
  {
    title: "Resources, watched live",
    body: (
      <>
        Every session samples CPU, memory, and output rate every two seconds. High CPU turns the
        dots amber wherever the session appears; <Key>⌘I</Key> opens the full inspector.
      </>
    ),
    visual: <MockMetrics />,
  },
  {
    title: "Charts synced to output",
    body: (
      <>
        Click a point on a resource chart and the terminal jumps to what it was printing at that
        moment. Select terminal output and the matching range lights up on every chart.
      </>
    ),
    visual: <MockSync />,
  },
  {
    title: "Ports, opened and shared",
    body: (
      <>
        Listening ports are detected automatically. Click one to open it in your browser — or copy a
        LAN or Tailscale link and open it from your phone.
      </>
    ),
    visual: <MockPorts />,
  },
  {
    title: "Find anything",
    body: (
      <>
        <Key>⌘K</Key> searches processes, actions, and archived runs. History and terminal logs are
        opt-in, in Settings — and this tour can be replayed from there too.
      </>
    ),
    visual: <MockPalette />,
  },
]

export function TutorialDialog() {
  const open = useStore((s) => s.tutorialOpen)
  if (!open) return null
  return <Tour />
}

function Tour() {
  const close = useStore((s) => s.closeTutorial)
  const settings = useStore((s) => s.settings)
  const [step, setStep] = useState(0)
  const last = step === STEPS.length - 1
  const current = STEPS[step]!

  /** Leaving the tour in any way counts as having seen it. */
  const finish = () => {
    close()
    if (!settings.onboarding.tutorialSeen) {
      actions.updateSettings({ ...settings, onboarding: { tutorialSeen: true } })
    }
  }

  // Enter is left alone: the focused primary button already advances on it.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") finish()
    if (event.key === "ArrowRight" && !last) setStep(step + 1)
    if (event.key === "ArrowLeft" && step > 0) setStep(step - 1)
  }

  return (
    <Overlay onDismiss={finish}>
      <Dialog label="Tutorial" className="w-[min(420px,100%)]" onKeyDown={onKeyDown}>
        <div className="flex flex-col gap-2.5 px-5 pt-5 pb-2">
          {current.visual}
          <h2 className="m-0 text-md font-semibold tracking-label">{current.title}</h2>
          <p className="m-0 min-h-[54px] text-base leading-relaxed text-surface-10">{current.body}</p>
        </div>
        <DialogFooter>
          {!last && <Button onClick={finish}>Skip</Button>}
          <span className="flex flex-1 items-center justify-center gap-1.5">
            {STEPS.map((entry, index) => (
              <button
                key={entry.title}
                type="button"
                aria-label={`Step ${index + 1}: ${entry.title}`}
                aria-current={index === step || undefined}
                className={cx(
                  "size-1.5 rounded-full p-0",
                  index === step ? "bg-accent-9" : "bg-surface-6 hover:bg-surface-8",
                )}
                onClick={() => setStep(index)}
              />
            ))}
          </span>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          <Button variant="primary" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </DialogFooter>
      </Dialog>
    </Overlay>
  )
}
