import { ArrowBigUp, Command as CommandIcon } from "lucide-react"
import { type KeyboardEvent } from "react"
import { useStore } from "../store"
import { Button } from "../ui/Button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"

type Shortcut = { key: string; description: string; shift?: boolean }

const GROUPS: Array<{ title: string; shortcuts: Shortcut[] }> = [
  {
    title: "Navigate",
    shortcuts: [
      { key: "K", description: "Open command palette" },
      { key: "I", description: "Toggle session inspector" },
      { key: ",", description: "Open settings" },
    ],
  },
  {
    title: "Active session",
    shortcuts: [
      { key: "R", description: "Restart, with confirmation" },
      { key: "R", shift: true, description: "Restart immediately" },
      { key: "W", description: "Close tab, confirming if it is running" },
      { key: "W", shift: true, description: "Stop and close immediately" },
      { key: "K", shift: true, description: "Clear terminal scrollback" },
    ],
  },
]

function Key({ keyName, shift = false }: { keyName?: string; shift?: boolean }) {
  return (
    <kbd className="inline-flex w-[62px] flex-none items-center justify-center gap-1 rounded-md border border-surface-6 bg-surface-a3 px-2 py-1 font-sans text-sm text-surface-12 shadow-[inset_0_-1px_var(--color-surface-5)]">
      <CommandIcon className="size-[14px]" strokeWidth={1.8} aria-label="Command" />
      {shift && <ArrowBigUp className="size-[14px]" strokeWidth={1.8} aria-label="Shift" />}
      {keyName && <span className="font-mono">{keyName}</span>}
    </kbd>
  )
}

export function HelpDialog() {
  const open = useStore((state) => state.helpOpen)
  const close = useStore((state) => state.closeHelp)
  const openTutorial = useStore((state) => state.openTutorial)
  if (!open) return null

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close()
  }

  return (
    <Overlay onDismiss={close}>
      <Dialog label="Help and keyboard shortcuts" className="w-[min(480px,100%)]!" onKeyDown={onKeyDown}>
        <DialogHeader title="Help & keyboard shortcuts" />
        <DialogBody className="gap-5 py-4">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mt-0 mb-1.5 text-2xs font-semibold tracking-caps text-surface-9 uppercase">
                {group.title}
              </h3>
              <div className="overflow-hidden rounded-md border border-surface-5 bg-surface-1">
                {group.shortcuts.map((shortcut) => (
                  <div key={`${shortcut.shift ? "shift-" : ""}${shortcut.key}`} className="flex min-h-[38px] items-center gap-4 border-b border-surface-4 px-3 py-1.5 last:border-b-0">
                    <span className="flex-1 text-base text-surface-11">{shortcut.description}</span>
                    <Key keyName={shortcut.key} shift={shortcut.shift} />
                  </div>
                ))}
              </div>
            </section>
          ))}
          <p className="m-0 flex items-center gap-1.5 text-xs leading-relaxed text-surface-9">
            Hold <Key /> to reveal shortcut hints on controls that support them.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => { close(); openTutorial() }}>Replay tutorial</Button>
          <span className="flex-1" />
          <Button variant="primary" onClick={close}>Done</Button>
        </DialogFooter>
      </Dialog>
    </Overlay>
  )
}
