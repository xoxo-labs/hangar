import { DEFAULT_SETTINGS, type AppSettings, type BrowserChoice } from "@hangar/contracts"
import { type KeyboardEvent, type MouseEvent, useState } from "react"
import * as actions from "../actions"
import { useStore } from "../store"

const FONT_OPTIONS = [
  { label: "Default (SF Mono / Menlo)", value: DEFAULT_SETTINGS.terminal.fontFamily },
  { label: "SF Mono", value: '"SF Mono", monospace' },
  { label: "Menlo", value: "Menlo, monospace" },
  { label: "Monaco", value: "Monaco, monospace" },
  { label: "JetBrains Mono", value: '"JetBrains Mono", monospace' },
  { label: "Fira Code", value: '"Fira Code", monospace' },
] as const

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20] as const

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  if (!open) return null
  return <Dialog initial={settings} />
}

function Dialog({ initial }: { initial: AppSettings }) {
  const close = useStore((s) => s.closeSettings)
  const [settings, setSettings] = useState(() => structuredClone(initial))
  const links = settings.links
  const terminal = settings.terminal
  const log = settings.terminalLogging
  const history = settings.sessionHistory

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
    <div className="overlay" onMouseDown={(event: MouseEvent) => event.target === event.currentTarget && close()}>
      <div className="dialog settings-dialog" role="dialog" aria-modal="true" aria-label="Settings" onKeyDown={onKeyDown}>
        <header className="dialog-header"><h2>Settings</h2></header>
        <div className="dialog-body">
          <div className="settings-section">
            <div className="settings-section-title">Links</div>
            <label className="field browser-field">
              <span className="field-label">Open detected ports with</span>
              <select className="input" value={links.browser} onChange={(e) => patchLinks({ browser: e.target.value as BrowserChoice })}>
                <option value="system">System default</option>
                {window.hangarDesktop && <><option value="safari">Safari</option><option value="chrome">Google Chrome</option><option value="arc">Arc</option><option value="firefox">Firefox</option><option value="brave">Brave</option><option value="edge">Microsoft Edge</option></>}
              </select>
            </label>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Terminal behavior</div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={terminal.copyOnSelect}
                onChange={(e) => patchTerminal({ copyOnSelect: e.target.checked })}
              />
              <span>
                <strong>Copy on select</strong>
                <small>Automatically copies selected terminal text to the clipboard.</small>
              </span>
            </label>
            <div className="terminal-settings-columns">
              <label className="field">
                <span className="field-label">Font family</span>
                <select
                  className="input mono"
                  value={terminal.fontFamily}
                  onChange={(e) => patchTerminal({ fontFamily: e.target.value })}
                >
                  {!FONT_OPTIONS.some((option) => option.value === terminal.fontFamily) && (
                    <option value={terminal.fontFamily}>Custom</option>
                  )}
                  {FONT_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Font size (px)</span>
                <select
                  className="input"
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
                </select>
              </label>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Session history</div>
            <label className="toggle-row">
              <input type="checkbox" checked={history.enabled} onChange={(e) => patchHistory({ enabled: e.target.checked })} />
              <span>
                <strong>Keep run history on this Mac</strong>
                <small>Saves timing, exit status, and resource peaks. It never saves terminal output.</small>
              </span>
            </label>
            <div className={`settings-fields compact${history.enabled ? "" : " disabled"}`}>
              <label className="field">
                <span className="field-label">Retention</span>
                <select className="input" disabled={!history.enabled} value={history.retentionDays ?? "forever"} onChange={(e) => patchHistory({ retentionDays: e.target.value === "forever" ? null : Number(e.target.value) as 7 | 30 | 90 })}>
                  <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value="forever">Forever</option>
                </select>
              </label>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Terminal logs</div>
            <label className="toggle-row">
              <input type="checkbox" checked={log.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
              <span>
                <strong>Save terminal output to disk</strong>
                <small>Applies to sessions started after saving.</small>
              </span>
            </label>
            <div className={`settings-fields${log.enabled ? "" : " disabled"}`}>
              <label className="field">
                <span className="field-label">Logs directory</span>
                <div className="path-row">
                  <input className="input mono" value={log.directory} disabled={!log.enabled} onChange={(e) => patch({ directory: e.target.value })} />
                  {window.hangarDesktop && <button type="button" className="button" disabled={!log.enabled} onClick={() => void browse()}>Choose…</button>}
                  {window.hangarDesktop && <button type="button" className="button" disabled={!log.enabled} onClick={() => void window.hangarDesktop?.openPath(log.directory)}>Open</button>}
                </div>
              </label>
              <div className="settings-columns">
                <label className="field">
                  <span className="field-label">Retention</span>
                  <select className="input" disabled={!log.enabled} value={log.retentionDays ?? "forever"} onChange={(e) => patch({ retentionDays: e.target.value === "forever" ? null : Number(e.target.value) as 7 | 30 })}>
                    <option value={7}>7 days</option><option value={30}>30 days</option><option value="forever">Forever</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Maximum file size (MB)</span>
                  <input className="input" type="number" min={1} max={1000} disabled={!log.enabled} value={log.maxFileSizeMb} onChange={(e) => patch({ maxFileSizeMb: Math.max(1, Number(e.target.value)) })} />
                </label>
                <label className="field">
                  <span className="field-label">Format</span>
                  <select className="input" disabled={!log.enabled} value={log.format} onChange={(e) => patch({ format: e.target.value as "plain" | "ansi" })}>
                    <option value="plain">Plain text</option><option value="ansi">Raw ANSI</option>
                  </select>
                </label>
              </div>
              <p className="settings-warning">Logs can contain tokens, private URLs, and other secrets.</p>
            </div>
          </div>
        </div>
        <footer className="dialog-footer"><span className="flex-1" /><button className="button" onClick={close}>Cancel</button><button className="button primary" onClick={save}>Save</button></footer>
      </div>
    </div>
  )
}
