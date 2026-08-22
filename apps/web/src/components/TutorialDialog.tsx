import {
  Activity,
  ChartLine,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  Globe,
  Network,
  Play,
  Search,
  type LucideIcon,
} from "lucide-react"
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
 * The shell borrows Settings' two-pane idiom: a rail of steps on the left, the
 * active step's schematic and copy on the right. The rail doubles as a progress
 * map — steps already seen read brighter than the ones still ahead — so it says
 * what the dots used to. Below a 560px viewport the rail would squeeze the
 * schematics, so it drops out and the dots take over; both drive `step`.
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
    <div
      aria-hidden="true"
      className="grid h-[128px] place-items-center overflow-hidden rounded-lg border border-surface-5 bg-surface-1 select-none"
    >
      {children}
    </div>
  )
}

/** Same polyline shape the real charts draw (ResourceMetrics `Sparkline`). */
function Spark({ points, className, marker }: { points: number[]; className?: string; marker?: number }) {
  const max = Math.max(...points)
  const xAt = (index: number) => (index / (points.length - 1)) * 100
  const path = points
    .map((value, index) => `${xAt(index).toFixed(1)},${(27 - (value / max) * 25).toFixed(1)}`)
    .join(" ")
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
      <polyline
        points={path}
        className="fill-none stroke-current [stroke-width:1.5] [vector-effect:non-scaling-stroke]"
      />
    </svg>
  )
}

/** Echo of the inspector's `Metric` card: label, readout, toned sparkline. */
function MetricCard({
  label,
  value,
  tone,
  points,
  marker,
}: {
  label: string
  value: string
  tone: string
  points: number[]
  marker?: number
}) {
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
      <span
        className={cx(
          "size-[6px] flex-none rounded-full",
          running ? "bg-success-10 shadow-glow shadow-success-a6" : "bg-surface-8",
        )}
      />
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

/*
 * The QR dialog's reach tiles resolving to a code. The QR is a fixed pattern,
 * not a real encoding: it only has to read as "point your phone here", and the
 * corner finder squares are what carry that at 63px.
 */
const QR_PATTERN = [
  "111010111",
  "101100101",
  "111011111",
  "000100000",
  "101101001",
  "011010110",
  "111011010",
  "101100101",
  "111001101",
]

function MockShare() {
  const reach = [
    ["Local network", false],
    ["Tailscale", false],
    ["Public link", true],
  ] as const

  return (
    <Frame>
      <div className="flex items-center gap-2.5">
        <ul className="m-0 w-[140px] list-none overflow-hidden rounded-md border border-surface-5 bg-surface-2 p-0">
          {reach.map(([label, live]) => (
            <li
              key={label}
              className={cx(
                "flex items-center gap-1.5 border-b border-surface-5 px-2 py-1.5 text-2xs last:border-b-0",
                live ? "bg-warning-a2 text-warning-11" : "text-surface-9",
              )}
            >
              {live && <Globe size={10} className="flex-none" />}
              {label}
            </li>
          ))}
        </ul>
        <span className="text-sm text-surface-8">→</span>
        <div className="rounded-md border border-surface-5 bg-surface-2 p-1.5">
          <div className="grid grid-cols-9 gap-px">
            {QR_PATTERN.flatMap((row, y) =>
              [...row].map((cell, x) => (
                <span
                  key={`${y}:${x}`}
                  className={cx("size-[6px] rounded-[1px]", cell === "1" ? "bg-surface-12" : "bg-transparent")}
                />
              )),
            )}
          </div>
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
          <kbd className="ml-auto rounded-sm border border-surface-6 bg-surface-a3 px-1 font-mono text-2xs text-surface-10">
            ⌘K
          </kbd>
        </div>
        <div className="p-1 text-xs text-surface-11">
          <p className="m-0 rounded-sm bg-surface-a4 px-1.5 py-0.5 text-surface-12">▶ Start app/web</p>
          <p className="m-0 px-1.5 py-0.5 text-surface-9">◷ web · yesterday</p>
        </div>
      </div>
    </Frame>
  )
}

type TutorialStep = {
  /** Full sentence, shown as the detail pane's header. Unique — the dots key on it. */
  title: string
  /** One word for the rail, where a full title would wrap three lines. */
  label: string
  icon: LucideIcon
  body: ReactNode
  visual: ReactNode
}

const STEPS: TutorialStep[] = [
  {
    title: "Open a folder, get a project",
    label: "Projects",
    icon: Folder,
    body: (
      <>
        Point hangar at a folder that&apos;s already on your Mac — nothing is cloned or copied. Its{" "}
        <code>package.json</code> scripts become processes; clicking one opens its tab, and ▶ is what starts it.
      </>
    ),
    visual: <MockProjects />,
  },
  {
    title: "Resources, watched live",
    label: "Resources",
    icon: Activity,
    body: (
      <>
        Every session samples CPU, memory, and output rate every two seconds. High CPU turns the dots amber wherever the
        session appears; <Key>⌘I</Key> opens the full inspector.
      </>
    ),
    visual: <MockMetrics />,
  },
  {
    title: "Charts synced to output",
    label: "Charts",
    icon: ChartLine,
    body: (
      <>
        Click a point on a resource chart and the terminal jumps to what it was printing at that moment. Select terminal
        output and the matching range lights up on every chart.
      </>
    ),
    visual: <MockSync />,
  },
  {
    title: "Ports, detected and opened",
    label: "Ports",
    icon: Network,
    body: (
      <>
        Listening ports are detected automatically. Click one to open it in your browser — or copy a LAN or Tailscale
        link and open it from your phone.
      </>
    ),
    visual: <MockPorts />,
  },
  {
    title: "Publish a port, scan the QR",
    label: "Publishing",
    icon: Globe,
    body: (
      <>
        Tailscale widens the ladder. From a port&apos;s QR dialog you can share it with just your own devices, or make
        it public on the internet — where whoever you send the link to needs no account and no client. Scan to open it
        on your phone; the status bar turns amber while anything is public.
      </>
    ),
    visual: <MockShare />,
  },
  {
    title: "Find anything",
    label: "Search",
    icon: Search,
    body: (
      <>
        <Key>⌘K</Key> searches processes, actions, and archived runs. History and terminal logs are opt-in, in Settings
        — and this tour can be replayed from there too.
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
  // Every step reached so far, so the rail can show how much of the tour is left.
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]))
  const last = step === STEPS.length - 1
  const current = STEPS[step]!

  const go = (index: number) => {
    setStep(index)
    setVisited((seen) => (seen.has(index) ? seen : new Set(seen).add(index)))
  }

  /** Leaving the tour in any way counts as having seen it. */
  const finish = () => {
    close()
    // `=== false` guards against a server old enough to not send `onboarding`.
    if (settings.onboarding?.tutorialSeen === false) {
      actions.updateSettings({ ...settings, onboarding: { tutorialSeen: true } })
    }
  }

  // Enter is left alone: the focused primary button already advances on it.
  // Up/Down are here too because a vertical rail is what the arrows now face.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") finish()
    if ((event.key === "ArrowRight" || event.key === "ArrowDown") && !last) go(step + 1)
    if ((event.key === "ArrowLeft" || event.key === "ArrowUp") && step > 0) go(step - 1)
  }

  return (
    <Overlay onDismiss={finish}>
      {/* Fixed height, not content height: the steps differ by a line or two of
          copy, and a dialog that resized under the cursor would move Next out
          from under it. The slack lands below the copy, which is top-aligned. */}
      <Dialog
        label="Tutorial"
        className="h-[min(360px,calc(100vh-48px))] w-[min(660px,100%)]! overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <div className="flex min-h-0 flex-1">
          {/* Below 560px the overlay leaves too little room for the widest
              schematic once 158px goes to the rail, so the dots stand in. */}
          <aside className="flex w-[158px] flex-none flex-col border-r border-surface-4 bg-surface-2 max-[560px]:hidden">
            <header className="flex min-h-[43px] flex-none items-center border-b border-surface-4 px-3.5">
              <h2 className="m-0 text-xs font-semibold tracking-caps text-surface-9 uppercase">Tutorial</h2>
            </header>
            <nav aria-label="Tutorial steps" className="flex flex-col gap-0.5 p-2">
              {STEPS.map((entry, index) => {
                const Icon = entry.icon
                const selected = index === step
                return (
                  <button
                    key={entry.title}
                    type="button"
                    aria-current={selected ? "step" : undefined}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-base outline-none transition-colors",
                      "focus-visible:shadow-[0_0_0_2px_var(--color-accent-a5)]",
                      selected
                        ? "bg-accent-a4 font-book text-accent-11"
                        : visited.has(index)
                          ? "text-surface-11 hover:bg-surface-a3 hover:text-surface-12"
                          : "text-surface-9 hover:bg-surface-a3 hover:text-surface-12",
                    )}
                    onClick={() => go(index)}
                  >
                    <Icon className="size-[15px] flex-none" strokeWidth={1.75} aria-hidden="true" />
                    <span>{entry.label}</span>
                  </button>
                )
              })}
            </nav>
          </aside>
          <main className="flex min-w-0 flex-1 flex-col">
            <header className="flex min-h-[43px] flex-none items-center justify-between gap-2 border-b border-surface-4 pr-2.5 pl-4">
              <h2 className="m-0 min-w-0 truncate text-md font-strong tracking-label">{current.title}</h2>
              {/* Leaving early is a corner affordance, not a step in the tour, so
                  it sits out of the way of Back/Next rather than beside them. */}
              {!last && (
                <Button variant="ghost" className="flex-none" onClick={finish}>
                  Skip
                </Button>
              )}
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
              {current.visual}
              <p className="m-0 text-base leading-relaxed text-surface-10">{current.body}</p>
            </div>
            <DialogFooter>
              {/* `mr-auto` only bites while the dots exist; above 560px they are
                  display:none and Back/Next keep the footer's own justify-end. */}
              <span className="mr-auto flex items-center gap-1.5 min-[560px]:hidden">
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
                    onClick={() => go(index)}
                  />
                ))}
              </span>
              {step > 0 && <Button onClick={() => go(step - 1)}>Back</Button>}
              <Button variant="primary" onClick={() => (last ? finish() : go(step + 1))}>
                {last ? "Done" : "Next"}
              </Button>
            </DialogFooter>
          </main>
        </div>
      </Dialog>
    </Overlay>
  )
}
