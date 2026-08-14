import { countdown, LOCAL_CONN_ID, pairingString, parsePairingString } from "@hangar/client-core"
import type { PairRequest, PairResponse, PairingInfo } from "@hangar/contracts"
import { Check, Copy, Pencil, X } from "lucide-react"
import { toDataURL } from "qrcode"
import { type FormEvent, useEffect, useState } from "react"
import * as actions from "../actions"
import { addConnection, removeConnection, retryConnection, updateConnection } from "../connections"
import { CONNECTION_LABEL, connectionTone } from "../status"
import { type ConnectionState, machineLabel, useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Field, TextInput } from "../ui/Field"
import { IconButton } from "../ui/IconButton"
import { ToggleRow } from "../ui/ToggleRow"
import { Dot } from "./Dot"

/** One boxed row, the same surface the toggle rows use. */
const CARD = "w-full rounded-md border border-surface-5 bg-surface-a2 p-[9px]"
const SUBHEAD = "mb-1.5 text-2xs font-semibold tracking-caps text-surface-9 uppercase"
const HINT = "m-0 text-xs leading-normal text-surface-9"
const ERROR = "m-0 text-xs leading-normal text-danger-11"
const MONO = "font-mono text-xs text-surface-10"

export function ConnectionsSettings({
  acceptRemote,
  onAcceptRemote,
}: {
  acceptRemote: boolean
  onAcceptRemote: (next: boolean) => void
}) {
  const connections = useStore((state) => state.connections)
  const paired = Object.values(connections).filter((connection) => connection.config.id !== LOCAL_CONN_ID)

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className={SUBHEAD}>This Mac</div>
        <ToggleRow
          checked={acceptRemote}
          onChange={onAcceptRemote}
          title="Let other Macs connect to this one"
          hint="Applies immediately. Traffic is unencrypted HTTP — Tailscale is the way to reach this Mac across networks."
        />
        {acceptRemote && <PairingPanel />}
        <PairedClients />
      </div>

      <div className="flex flex-col gap-2">
        <div className={SUBHEAD}>Paired machines</div>
        {paired.length === 0 ? (
          <p className={HINT}>No other Macs are paired yet.</p>
        ) : (
          paired.map((connection) => <MachineRow key={connection.config.id} connection={connection} />)
        )}
        <AddMachineForm />
      </div>
    </div>
  )
}

/** Mints a one-time code and shows every way of getting it onto the other Mac. */
function PairingPanel() {
  const showNotice = useStore((state) => state.showNotice)
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [chosenHost, setChosenHost] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const now = useNow(pairing !== null)

  const candidates = pairing === null ? [] : [...pairing.hosts.tailscale, ...pairing.hosts.lan]
  const host = chosenHost ?? candidates[0] ?? null
  const remaining = pairing === null ? 0 : pairing.expiresAt - now
  const expired = pairing !== null && remaining <= 0
  const paste = pairing === null || host === null ? null : pairingString(host, pairing.port, pairing.token)

  useEffect(() => {
    if (paste === null || expired) {
      setQr(null)
      return
    }
    let live = true
    void toDataURL(paste, { margin: 1, width: 148 })
      .then((url) => {
        if (live) setQr(url)
      })
      .catch(() => {
        if (live) setQr(null)
      })
    return () => {
      live = false
    }
  }, [paste, expired])

  const generate = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const info = await actions.createPairingToken(LOCAL_CONN_ID)
      setPairing(info)
      setChosenHost(null)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not create a pairing code.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cx(CARD, "flex flex-col gap-2")}>
      <div className="flex items-center gap-2">
        <Button onClick={() => void generate()} disabled={busy}>
          {busy ? "Working…" : pairing === null ? "New pairing code" : "New code"}
        </Button>
        {pairing !== null && (
          <span className={cx("text-xs tabular-nums", expired ? "text-danger-11" : "text-surface-9")}>
            {expired ? "Expired" : `Expires in ${countdown(remaining)}`}
          </span>
        )}
        {pairing === null && <span className="text-xs text-surface-9">Single use, good for five minutes.</span>}
      </div>

      {error !== null && <p className={ERROR}>{error}</p>}

      {pairing !== null && (
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div
              className={cx(
                "font-mono text-lg tracking-[0.16em] tabular-nums",
                expired ? "text-surface-8 line-through" : "text-surface-12",
              )}
            >
              {pairing.token}
            </div>
            {candidates.length === 0 ? (
              <p className={HINT}>No network address found. Connect to Wi-Fi or Tailscale, then make a new code.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {candidates.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={cx(
                      "flex items-center gap-1.5 rounded-md px-1.5! py-0.5! text-left font-mono text-xs!",
                      candidate === host ? "bg-surface-a4! text-surface-12!" : "text-surface-9! hover:bg-surface-a3!",
                    )}
                    onClick={() => setChosenHost(candidate)}
                  >
                    {candidate === host && <Check className="size-[11px] flex-none" aria-hidden="true" />}
                    <span className="truncate">
                      {candidate}:{pairing.port}
                    </span>
                    {pairing.hosts.tailscale.includes(candidate) && (
                      <span className="flex-none font-sans text-2xs text-surface-8">Tailscale</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {paste !== null && (
              <div className="flex items-center gap-1.5">
                <code className={cx(MONO, "min-w-0 flex-1 truncate bg-transparent! p-0!")}>{paste}</code>
                <IconButton
                  className="size-[24px]"
                  title="Copy the pairing string"
                  aria-label="Copy the pairing string"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(paste)
                      .then(() => showNotice("Copied pairing string"))
                      .catch(() => showNotice("Could not copy"))
                  }}
                >
                  <Copy className="size-[13px]" aria-hidden="true" />
                </IconButton>
              </div>
            )}
            <p className={HINT}>Paste it into Settings → Connections on the other Mac.</p>
          </div>
          {qr !== null && (
            <img
              src={qr}
              alt="Pairing code"
              className="size-[92px] flex-none rounded-md bg-white p-1"
              width={92}
              height={92}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** The clients holding a session token on this Mac, newest pairing last. */
function PairedClients() {
  const sessions = useStore((state) => state.connections[LOCAL_CONN_ID]?.authSessions)
  const [confirming, setConfirming] = useState<string | null>(null)

  if (sessions === undefined || sessions.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className={cx(SUBHEAD, "mt-1 mb-0")}>Paired clients</div>
      {sessions.map((session) => (
        <div key={session.id} className={cx(CARD, "flex items-center gap-2")}>
          <span className="flex min-w-0 flex-1 flex-col">
            <strong className="truncate text-base font-book text-surface-12">{session.label}</strong>
            <small className="text-xs text-surface-9">
              Paired {stamp(session.createdAt)} · last seen {stamp(session.lastSeenAt)}
            </small>
          </span>
          <Button
            variant="danger"
            className={cx("flex-none", confirming === session.id && "bg-danger-10! text-white!")}
            onBlur={() => setConfirming(null)}
            onClick={() => {
              if (confirming !== session.id) {
                setConfirming(session.id)
                return
              }
              setConfirming(null)
              actions.revokeAuthSession(LOCAL_CONN_ID, session.id)
            }}
          >
            {confirming === session.id ? "Really revoke?" : "Revoke"}
          </Button>
        </div>
      ))}
    </div>
  )
}

function MachineRow({ connection }: { connection: ConnectionState }) {
  const { config, status } = connection
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(config.label)
  const [confirming, setConfirming] = useState(false)

  const commit = (): void => {
    setEditing(false)
    const next = label.trim()
    if (next === "" || next === config.label) {
      setLabel(config.label)
      return
    }
    updateConnection(config.id, { label: next })
  }

  return (
    <div className={cx(CARD, "flex items-center gap-2")}>
      <Dot tone={connectionTone(status)} small title={CONNECTION_LABEL[status]} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {editing ? (
          <TextInput
            autoFocus
            className="py-[3px]!"
            value={label}
            spellCheck={false}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit()
              if (event.key === "Escape") {
                event.stopPropagation()
                setLabel(config.label)
                setEditing(false)
              }
            }}
          />
        ) : (
          <strong className="truncate text-base font-book text-surface-12">{machineLabel(connection)}</strong>
        )}
        <small className="truncate text-xs text-surface-9">
          <code className={cx(MONO, "bg-transparent! p-0!")}>
            {config.host}:{config.port}
          </code>{" "}
          · {connection.error ?? CONNECTION_LABEL[status]}
        </small>
      </span>
      {status === "blocked" && (
        <Button className="flex-none" onClick={() => retryConnection(config.id)}>
          Retry
        </Button>
      )}
      {!editing && (
        <IconButton
          className="size-[26px] flex-none"
          title="Rename this machine"
          aria-label="Rename this machine"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-[13px]" aria-hidden="true" />
        </IconButton>
      )}
      <Button
        variant="danger"
        className={cx("flex-none", confirming && "bg-danger-10! text-white!")}
        onBlur={() => setConfirming(false)}
        onClick={() => {
          if (!confirming) {
            setConfirming(true)
            return
          }
          removeConnection(config.id)
        }}
      >
        {confirming ? "Really remove?" : "Remove"}
      </Button>
    </div>
  )
}

/** Redeems a pairing code on the other Mac, then keeps the session token it hands back. */
function AddMachineForm() {
  const myName = useStore((state) => state.connections[LOCAL_CONN_ID]?.serverName)
  const [open, setOpen] = useState(false)
  const [paste, setPaste] = useState("")
  const [host, setHost] = useState("")
  const [port, setPort] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = (): void => {
    setPaste("")
    setHost("")
    setPort("")
    setCode("")
    setError(null)
  }

  if (!open) {
    return (
      <Button
        className="self-start"
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        + Add machine
      </Button>
    )
  }

  // A pasted string fills the three fields, which stay editable on their own.
  const onPaste = (value: string): void => {
    setPaste(value)
    const parsed = parsePairingString(value)
    if (parsed === null) return
    setHost(parsed.host)
    setPort(String(parsed.port))
    if (parsed.code !== "") setCode(parsed.code)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const address = host.trim()
    const portNumber = Number.parseInt(port, 10)
    const token = code.trim().toUpperCase()
    if (address === "" || !Number.isInteger(portNumber) || token === "") {
      setError("Fill in the address and the pairing code.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`http://${address}:${portNumber}/api/auth/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, label: myName ?? "Hangar" } satisfies PairRequest),
      })
      if (response.status === 401) {
        setError("That code is wrong or has expired. Make a new one on the other Mac.")
        return
      }
      if (response.status === 429) {
        setError("That Mac stopped accepting codes after too many tries. Make a fresh code there.")
        return
      }
      if (!response.ok) {
        setError(`That Mac refused the pairing (${response.status}).`)
        return
      }
      const body = (await response.json()) as PairResponse
      addConnection({
        label: body.serverName || address,
        host: address,
        port: portNumber,
        token: body.sessionToken,
      })
      reset()
      setOpen(false)
    } catch {
      setError("Could not reach that Mac. Check the address, and that it lets other Macs connect.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={cx(CARD, "flex flex-col gap-2.5")} onSubmit={(event) => void submit(event)}>
      <Field label="Pairing string" hint="From Settings → Connections on the other Mac.">
        <TextInput
          autoFocus
          mono
          value={paste}
          spellCheck={false}
          autoComplete="off"
          placeholder="100.90.1.5:4780#ABCD2345WXYZ"
          onChange={(event) => onPaste(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-[minmax(0,2fr)_80px_minmax(0,1.6fr)] gap-2">
        <Field label="Host">
          <TextInput
            mono
            value={host}
            spellCheck={false}
            autoComplete="off"
            placeholder="100.90.1.5"
            onChange={(event) => setHost(event.target.value)}
          />
        </Field>
        <Field label="Port">
          <TextInput
            mono
            value={port}
            spellCheck={false}
            autoComplete="off"
            placeholder="4780"
            onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label="Code">
          <TextInput
            mono
            value={code}
            spellCheck={false}
            autoComplete="off"
            placeholder="ABCD2345WXYZ"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </Field>
      </div>
      {error !== null && <p className={ERROR}>{error}</p>}
      <div className="flex items-center gap-1.5">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Pairing…" : "Pair"}
        </Button>
        <Button
          onClick={() => {
            reset()
            setOpen(false)
          }}
        >
          Cancel
        </Button>
        <span className="flex-1" />
        <IconButton className="size-[26px]" title="Clear the form" aria-label="Clear the form" onClick={() => reset()}>
          <X className="size-[13px]" aria-hidden="true" />
        </IconButton>
      </div>
    </form>
  )
}

/** Ticks once a second while something on screen counts down. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function stamp(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date().toDateString() === date.toDateString()
  return today
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
