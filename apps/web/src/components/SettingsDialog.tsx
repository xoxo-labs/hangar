import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BrowserChoice,
  type ShareHostChoice,
  type ThemeSetting,
} from "@hangar/contracts"
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react"
import * as actions from "../actions"
import { useDesktopUpdate } from "../hooks/useDesktopUpdate"
import { openPortUrl } from "../links"
import { useStore } from "../store"
import { ConnectionsSettings } from "./ConnectionsSettings"
import { resolveUpdateAction, type UpdateActionKind, updateStatusLine } from "./settingsUpdate.logic"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { Field, Select, TextInput } from "../ui/Field"
import { ToggleRow } from "../ui/ToggleRow"

const FONT_OPTIONS = [
  { label: "Default (SF Mono / Menlo)", value: DEFAULT_SETTINGS.terminal.fontFamily },
  { label: "SF Mono", value: '"SF Mono", monospace' },
  { label: "Menlo", value: "Menlo, monospace" },
  { label: "Monaco", value: "Monaco, monospace" },
  { label: "JetBrains Mono", value: '"JetBrains Mono", monospace' },
  { label: "Fira Code", value: '"Fira Code", monospace' },
] as const

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20] as const

/* `select.input:hover:not(:disabled)` — the one bit of the old select styling the
   shared Select primitive does not carry, kept here so the border still lifts. */
const SELECT_HOVER = "enabled:hover:border-surface-7"

/** Old `.settings-section` + `.settings-section-title`. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="w-full">
      <div className="mb-[9px] text-sm font-semibold tracking-label text-surface-10 uppercase">{title}</div>
      {children}
    </div>
  )
}

function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent-10 underline underline-offset-2 hover:text-accent-11"
      onClick={(event) => {
        if (!window.hangarDesktop) return
        event.preventDefault()
        void openPortUrl(href, "system").catch((error) => useStore.getState().setError(String(error)))
      }}
    >
      {children}
    </a>
  )
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  if (!open) return null
  return <SettingsForm initial={settings} />
}

function SettingsForm({ initial }: { initial: AppSettings }) {
  const close = useStore((s) => s.closeSettings)
  const openReleaseNotes = useStore((s) => s.openReleaseNotes)
  const openTutorial = useStore((s) => s.openTutorial)
  const [version, setVersion] = useState("development")
  const [settings, setSettings] = useState(() => structuredClone(initial))
  const update = useDesktopUpdate()
  const [confirmInstall, setConfirmInstall] = useState(false)
  const appearance = settings.appearance
  const links = settings.links
  const terminal = settings.terminal
  const log = settings.terminalLogging
  const history = settings.sessionHistory

  useEffect(() => {
    if (window.hangarDesktop) {
      void window.hangarDesktop.appInfo().then((info) => setVersion(info.version))
      // Opening settings is a natural moment for a fresh check; the main
      // process skips it while a download is running or staged.
      void window.hangarDesktop.checkForUpdate()
    }
  }, [])

  const runUpdateAction = (kind: UpdateActionKind) => {
    const desktop = window.hangarDesktop
    if (!desktop) return
    if (kind === "install" && !confirmInstall) {
      setConfirmInstall(true)
      return
    }
    setConfirmInstall(false)
    if (kind === "check") void desktop.checkForUpdate()
    else if (kind === "download") void desktop.downloadUpdate()
    else void desktop.installUpdate()
  }

  const updateAction = update === null ? null : resolveUpdateAction(update)

  const patchAppearance = (next: Partial<AppSettings["appearance"]>) =>
    setSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, ...next },
    }))

  const patchLinks = (next: Partial<AppSettings["links"]>) =>
    setSettings((current) => ({
      ...current,
      links: { ...current.links, ...next },
    }))

  const patchTerminal = (next: Partial<AppSettings["terminal"]>) =>
    setSettings((current) => ({
      ...current,
      terminal: { ...current.terminal, ...next },
    }))

  const patch = (next: Partial<AppSettings["terminalLogging"]>) =>
    setSettings((current) => ({
      ...current,
      terminalLogging: { ...current.terminalLogging, ...next },
    }))

  const patchHistory = (next: Partial<AppSettings["sessionHistory"]>) =>
    setSettings((current) => ({
      ...current,
      sessionHistory: { ...current.sessionHistory, ...next },
    }))

  /*
   * The only setting that is not held back until Save: flipping it re-binds the
   * server, and everything else in the Connections section (pairing codes, adding
   * and removing machines) already acts at once and depends on it. The draft is
   * kept in step so a later Save cannot roll it back.
   */
  const setAcceptRemote = (acceptRemote: boolean) => {
    setSettings((current) => ({ ...current, connections: { ...current.connections, acceptRemote } }))
    const saved = useStore.getState().settings
    actions.updateSettings({ ...saved, connections: { ...saved.connections, acceptRemote } })
  }

  const save = () => {
    actions.updateSettings(settings)
    close()
  }

  const browse = async () => {
    const selected = await window.hangarDesktop?.chooseDirectory("Choose a logs folder")
    if (selected) patch({ directory: selected })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close()
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save()
  }

  return (
    <Overlay onDismiss={close}>
      <Dialog label="Settings" className="w-[min(620px,100%)]" onKeyDown={onKeyDown}>
        <DialogHeader title="Settings" />
        <DialogBody>
          <Section title="Appearance">
            <Field label="Theme">
              <Select
                className={SELECT_HOVER}
                value={appearance.theme}
                onChange={(e) => patchAppearance({ theme: e.target.value as ThemeSetting })}
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
            <div className="mt-3">
              <ToggleRow
                checked={appearance.shortcutHints}
                onChange={(shortcutHints) => patchAppearance({ shortcutHints })}
                title="Show keyboard shortcut hints"
                hint="Reveal keycaps on controls while holding Command."
              />
            </div>
          </Section>
          <Section title="Links">
            <div className="grid max-w-[420px] grid-cols-2 gap-2.5">
              <Field label="Open detected ports with">
                <Select
                  className={SELECT_HOVER}
                  value={links.browser}
                  onChange={(e) => patchLinks({ browser: e.target.value as BrowserChoice })}
                >
                  <option value="system">System default</option>
                  {window.hangarDesktop && (
                    <>
                      <option value="safari">Safari</option>
                      <option value="chrome">Google Chrome</option>
                      <option value="arc">Arc</option>
                      <option value="firefox">Firefox</option>
                      <option value="brave">Brave</option>
                      <option value="edge">Microsoft Edge</option>
                    </>
                  )}
                </Select>
              </Field>
              <Field label="Reach ports at">
                <Select
                  className={SELECT_HOVER}
                  value={links.shareHost}
                  onChange={(e) => patchLinks({ shareHost: e.target.value as ShareHostChoice })}
                >
                  <option value="auto">Automatic</option>
                  <option value="lan">Local network</option>
                  <option value="tailscale">Tailscale</option>
                  <option value="custom">Custom host</option>
                </Select>
              </Field>
            </div>
            {links.shareHost === "custom" && (
              <Field
                label="Custom host"
                hint="Hostname or IP address, without a port."
                className="mt-2.5 max-w-[260px]"
              >
                <TextInput
                  mono
                  value={links.customHost}
                  placeholder="dev.example.test"
                  spellCheck={false}
                  onChange={(e) => patchLinks({ customHost: e.target.value })}
                />
              </Field>
            )}
            <p className="mt-2 mb-0 text-xs leading-normal text-surface-9">
              The address a detected port is opened and copied at. LAN links work on the same Wi-Fi, Tailscale links on
              devices in your tailnet; a custom host covers a port that answers somewhere else, like a forwarded one.
            </p>
            <div className="mt-3">
              <ToggleRow
                checked={links.tailnetSharing}
                onChange={(tailnetSharing) => patchLinks({ tailnetSharing })}
                title="Show Tailnet HTTPS sharing"
                hint="Adds the private tailnet option alongside the public-link control."
              />
            </div>
            <p className="mt-2 mb-0 text-xs leading-normal text-surface-9">
              Tailnet HTTPS uses Tailscale{" "}
              <DocsLink href="https://tailscale.com/kb/1242/tailscale-serve">Serve</DocsLink> and your tailnet&apos;s{" "}
              <DocsLink href="https://tailscale.com/kb/1018/acls">access policy</DocsLink>. Public links use Funnel and
              remain available when this is off.
            </p>
          </Section>
          <Section title="Terminal behavior">
            <ToggleRow
              checked={terminal.copyOnSelect}
              onChange={(next) => patchTerminal({ copyOnSelect: next })}
              title="Copy on select"
              hint="Automatically copies selected terminal text to the clipboard."
            />
            <div className="mt-3 grid grid-cols-[minmax(0,2fr)_110px] gap-2.5">
              <Field label="Font family">
                <Select
                  mono
                  className={SELECT_HOVER}
                  value={terminal.fontFamily}
                  onChange={(e) => patchTerminal({ fontFamily: e.target.value })}
                >
                  {!FONT_OPTIONS.some((option) => option.value === terminal.fontFamily) && (
                    <option value={terminal.fontFamily}>Custom</option>
                  )}
                  {FONT_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Font size (px)">
                <Select
                  className={SELECT_HOVER}
                  value={terminal.fontSize}
                  onChange={(e) => patchTerminal({ fontSize: Number(e.target.value) })}
                >
                  {!FONT_SIZES.some((size) => size === terminal.fontSize) && (
                    <option value={terminal.fontSize}>{terminal.fontSize} px</option>
                  )}
                  {FONT_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size === DEFAULT_SETTINGS.terminal.fontSize ? `Default (${size} px)` : `${size} px`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Section>
          <Section title="Session history">
            <ToggleRow
              checked={history.enabled}
              onChange={(next) => patchHistory({ enabled: next })}
              title="Keep run history on this Mac"
              hint="Saves timing, resources, and up to 10 MB of timestamped terminal output per run."
            />
            <div className={cx("mt-3 flex max-w-[180px] flex-col gap-3", !history.enabled && "opacity-55")}>
              <Field label="Retention">
                <Select
                  className={SELECT_HOVER}
                  disabled={!history.enabled}
                  value={history.retentionDays ?? "forever"}
                  onChange={(e) =>
                    patchHistory({
                      retentionDays: e.target.value === "forever" ? null : (Number(e.target.value) as 7 | 30 | 90),
                    })
                  }
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value="forever">Forever</option>
                </Select>
              </Field>
            </div>
          </Section>
          <Section title="Connections">
            <ConnectionsSettings
              acceptRemote={settings.connections?.acceptRemote === true}
              onAcceptRemote={setAcceptRemote}
            />
          </Section>
          <Section title="About">
            <div className="flex items-center justify-between rounded-md border border-surface-5 p-[10px]">
              <div>
                <strong className="block text-base font-book">Hangar</strong>
                <span className="text-xs tabular-nums text-surface-9">Version {version}</span>
              </div>
              <div className="flex gap-1.5">
                <Button
                  onClick={() => {
                    close()
                    openTutorial()
                  }}
                >
                  Replay tutorial
                </Button>
                <Button
                  onClick={() => {
                    close()
                    openReleaseNotes()
                  }}
                >
                  Release notes
                </Button>
              </div>
            </div>
            {update !== null && update.status !== "disabled" && (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-surface-5 bg-surface-a2 p-[10px]">
                <span className={cx("text-xs", update.status === "error" ? "text-danger-10" : "text-surface-9")}>
                  {confirmInstall
                    ? "Running processes will be stopped, then Hangar restarts on the new version."
                    : updateStatusLine(update)}
                </span>
                {confirmInstall ? (
                  <div className="flex shrink-0 gap-1.5">
                    <Button onClick={() => setConfirmInstall(false)}>Cancel</Button>
                    <Button variant="primary" onClick={() => runUpdateAction("install")}>
                      Restart now
                    </Button>
                  </div>
                ) : (
                  updateAction !== null && (
                    <Button
                      className="shrink-0"
                      variant={updateAction.kind === "check" ? "default" : "primary"}
                      onClick={() => runUpdateAction(updateAction.kind)}
                    >
                      {updateAction.label}
                    </Button>
                  )
                )}
              </div>
            )}
          </Section>
          <Section title="Terminal logs">
            <ToggleRow
              checked={log.enabled}
              onChange={(next) => patch({ enabled: next })}
              title="Save terminal output to disk"
              hint="Applies to sessions started after saving."
            />
            <div className={cx("mt-3 flex flex-col gap-3", !log.enabled && "opacity-55")}>
              <Field label="Logs directory">
                <div className="flex w-full gap-1.5">
                  <TextInput
                    mono
                    value={log.directory}
                    disabled={!log.enabled}
                    onChange={(e) => patch({ directory: e.target.value })}
                  />
                  {window.hangarDesktop && (
                    <Button disabled={!log.enabled} onClick={() => void browse()}>
                      Choose…
                    </Button>
                  )}
                  {window.hangarDesktop && (
                    <Button disabled={!log.enabled} onClick={() => void window.hangarDesktop?.openPath(log.directory)}>
                      Open
                    </Button>
                  )}
                </div>
              </Field>
              <div className="grid grid-cols-[1fr_1.25fr_1fr] gap-2.5">
                <Field label="Retention">
                  <Select
                    className={SELECT_HOVER}
                    disabled={!log.enabled}
                    value={log.retentionDays ?? "forever"}
                    onChange={(e) =>
                      patch({ retentionDays: e.target.value === "forever" ? null : (Number(e.target.value) as 7 | 30) })
                    }
                  >
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value="forever">Forever</option>
                  </Select>
                </Field>
                <Field label="Maximum file size (MB)">
                  <TextInput
                    type="number"
                    min={1}
                    max={1000}
                    disabled={!log.enabled}
                    value={log.maxFileSizeMb}
                    onChange={(e) => patch({ maxFileSizeMb: Math.max(1, Number(e.target.value)) })}
                  />
                </Field>
                <Field label="Format">
                  <Select
                    className={SELECT_HOVER}
                    disabled={!log.enabled}
                    value={log.format}
                    onChange={(e) => patch({ format: e.target.value as "plain" | "ansi" })}
                  >
                    <option value="plain">Plain text</option>
                    <option value="ansi">Raw ANSI</option>
                  </Select>
                </Field>
              </div>
              <p className="m-0 text-sm text-warning-9">Logs can contain tokens, private URLs, and other secrets.</p>
            </div>
          </Section>
        </DialogBody>
        <DialogFooter>
          <span className="flex-1" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" data-shortcut-hint="↵" onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </Dialog>
    </Overlay>
  )
}
