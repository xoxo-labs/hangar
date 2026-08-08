import { ChevronRight, Copy, ExternalLink, Folder, Play, Search } from "lucide-react"
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
    <div aria-hidden="true" className="grid h-[128px] place-items-center overflow-hidden rounded-lg border border-surface-5 bg-surface-1 select-none">
      {children}
    </div>
  )
}

/** Same polyline shape the real charts draw (ResourceMetrics `Sparkline`). */
function Spark({ points, className, marker }: { points: number[]; className?: string; marker?: number }) {
  const max = Math.max(...points)
  const xAt = (index: number) => (index / (points.length - 1)) * 100
  const path = points.map((value, index) => `${xAt(index).toFixed(1)},${(27 - (value / max) * 25).toFixed(1)}`).join(" ")
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={cx("h-[18px] w-full overflow-visible", className)}>
      {marker !== undefined && (
        <line
          x1={xAt(marker)}
          x2={xAt(marker)}
          y1="0"
          y2="28"
          className="stroke-surface-11 opacity-45 [stroke-width:1] [vector-effect:non-scaling-stroke]"
        />
      )}
      <polyline points={path} className="fill-none stroke-current [stroke-width:1.5] [vector-effect:non-scaling-stroke]" />
    </svg>
  )
}

/** Echo of the inspector's `Metric` card: label, readout, toned sparkline. */
function MetricCard({ label, value, tone, points, marker }: { label: string; value: string; tone: string; points: number[]; marker?: number }) {
  return (
    <div className="w-[104px] rounded-md border border-surface-5 bg-surface-a2 p-[8px]">
      <span className="block text-xs text-surface-9">{label}</span>
      <strong className="mt-[2px] block text-lg font-book text-surface-12">{value}</strong>
      <Spark points={points} className={tone} marker={marker} />
    </div>
  )
}

function MockRow({ name, running = false }: { name: string; running?: boolean }) {
  return (
    <li className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-base text-surface-11">
      <span className={cx("size-[6px] flex-none rounded-full", running ? "bg-success-10 shadow-glow shadow-success-a6" : "bg-surface-8")} />
      {name}
      {!running && <Play size={9} className="ml-auto text-surface-9" />}
    </li>
  )
}

/** A folder becoming a sidebar project group: opened in place, never cloned. */
function MockProjects() {
  return (
    <Frame>
      <div className="flex items-center gap-2.5">
        <span className="flex items-center gap-1.5 rounded-md border border-surface-5 bg-surface-a3 px-2 py-1 font-mono text-xs text-surface-10">
          <Folder size={11} /> ~/code/app
        </span>
        <span className="text-sm text-surface-8">→</span>
        <div className="w-[140px] rounded-md border border-surface-5 bg-surface-2 p-1.5">
          <div className="flex items-center gap-1 px-1 pb-0.5 text-md font-semibold text-surface-12">
            <ChevronRight size={11} className="flex-none rotate-90 text-surface-9" />
            app
            <span className="ml-auto text-2xs font-normal tabular-nums text-surface-9">2/3</span>
          </div>
          <ul className="m-0 ml-2 list-none border-l border-surface-5 p-0 pl-2">
            <MockRow name="web" running />
            <MockRow name="api" running />
            <MockRow name="db" />
          </ul>
        </div>
      </div>
    </Frame>
  )
}

const CPU_POINTS = [8, 11, 9, 14, 22, 19, 34, 58, 81, 93]
const MEM_POINTS = [38, 40, 41, 45, 44, 47, 49, 50, 52, 51]

/** Metric cards over the session strip, with its amber high-CPU readout. */
function MockMetrics() {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex gap-[7px]">
          <MetricCard label="CPU" value="93%" tone="text-accent-10" points={CPU_POINTS} />
          <MetricCard label="Memory" value="412 MB" tone="text-success-10" points={MEM_POINTS} />
        </div>
        <div className="flex items-center gap-[8px] text-sm text-surface-9">
          <span className="font-semibold tabular-nums text-warning-11">CPU 93%</span>
          <strong className="font-book text-surface-11">web</strong>
          <span>2h 14m</span>
          <i className="h-[12px] w-px bg-surface-5" />
          <span>412 MB</span>
        </div>
      </div>
    </Frame>
  )
}

const SYNC_POINTS = [18, 24, 20, 30, 62, 34, 26, 30, 24, 28]

/** A chart point and the output line it maps to, cross-linked both ways. */
function MockSync() {
  return (
    <Frame>
      <div className="flex items-center gap-3">
        <MetricCard label="CPU" value="61%" tone="text-accent-10" points={SYNC_POINTS} marker={4} />
        <span className="text-sm text-surface-8">⇄</span>
        <div className="w-[150px] rounded-md border border-surface-5 bg-surface-2 p-1.5 font-mono text-2xs leading-relaxed text-surface-9">
          <p className="m-0 truncate">ready in 812 ms</p>
          {/* The real jump flashes `.metric-line-decoration` — an inset amber hairline. */}
          <p className="m-0 -mx-1.5 truncate bg-surface-a3 px-1.5 text-surface-11 shadow-[inset_0_1px_var(--color-warning-a6)]">
            compiling /app…
          </p>
          <p className="m-0 truncate">✓ compiled in 4.2 s</p>
        </div>
      </div>
    </Frame>
  )
}

/** The session strip's port button plus the inspector's binding rows. */
function MockPorts() {
  const bindings = [
    ["Local", "127.0.0.1"],
    ["LAN", "192.168.1.24"],
    ["Tailscale", "100.84.3.7"],
  ]

  return (
    <Frame>
      <div className="flex items-center gap-2.5">
        <div className="rounded-md border border-surface-5 bg-surface-a2 px-2.5 py-2 text-center">
          <span className="block text-2xs tracking-label text-surface-8">PORT</span>
          <span className="mt-1 flex items-center gap-1.5 text-base font-semibold tabular-nums text-accent-10">
            :3000 <ExternalLink size={11} />
          </span>
        </div>
        <span className="text-sm text-surface-8">→</span>
        <ul className="m-0 w-[196px] list-none overflow-hidden rounded-md border border-surface-5 bg-surface-2 p-0">
          {bindings.map(([label, address]) => (
            <li key={label} className="flex items-center gap-2 border-b border-surface-5 px-2 py-1.5 last:border-b-0">
              <span className="w-[48px] text-2xs text-surface-9">{label}</span>
              <span className="flex-1 font-mono text-2xs tabular-nums text-surface-11">{address}</span>
              <Copy size={10} className="flex-none text-surface-8" />
            </li>
          ))}
        </ul>
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
          <p className="m-0 rounded-sm bg-surface-a4 px-1.5 py-0.5 text-surface-12">▶ Start app/web</p>
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
    // `=== false` guards against a server old enough to not send `onboarding`.
    if (settings.onboarding?.tutorialSeen === false) {
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
      <Dialog label="Tutorial" className="w-[min(400px,100%)]!" onKeyDown={onKeyDown}>
        <div className="flex flex-col gap-2.5 px-5 pt-5 pb-2">
          {current.visual}
          <h2 className="m-0 text-md font-semibold tracking-label">{current.title}</h2>
          <p className="m-0 min-h-[60px] text-base leading-relaxed text-surface-10">{current.body}</p>
        </div>
        <DialogFooter className="grid grid-cols-[1fr_auto_1fr]">
          <span className="justify-self-start">{!last && <Button onClick={finish}>Skip</Button>}</span>
          <span className="flex items-center justify-center gap-1.5">
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
          <span className="flex justify-self-end gap-2">
            {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
            <Button variant="primary" onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? "Done" : "Next"}
            </Button>
          </span>
        </DialogFooter>
      </Dialog>
    </Overlay>
  )
}
