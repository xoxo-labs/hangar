import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AuthSessionInfo } from "@hangar/contracts"
import { hangarHome } from "./registry.ts"

/** Ambiguous glyphs (0/O, 1/I/L) are left out: pairing codes get read off a screen. */
const PAIRING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
const PAIRING_LENGTH = 12
const PAIRING_TTL_MS = 5 * 60 * 1000
const TICKET_TTL_MS = 60 * 1000
/** A live pairing grant is a 12-char secret; stop answering long before it can be guessed. */
const MAX_PAIR_FAILURES = 20
const LAST_SEEN_THROTTLE_MS = 60 * 1000
const MAX_LABEL_LENGTH = 64

type StoredSession = {
  id: string
  tokenHash: string
  label: string
  createdAt: number
  lastSeenAt: number
}

type AuthFile = { version: 1; sessions: StoredSession[] }

export type PairResult =
  | { ok: true; sessionToken: string; sessionId: string }
  | { ok: false; reason: "invalid" | "locked" }

let cache: AuthFile | null = null
let grant: { token: string; expiresAt: number } | null = null
let pairFailures = 0
const tickets = new Map<string, { sessionId: string; expiresAt: number }>()

export function authPath(): string {
  return join(hangarHome(), "auth.json")
}

function isStoredSession(value: unknown): value is StoredSession {
  const session = value as StoredSession | null
  return (
    !!session &&
    typeof session.id === "string" &&
    typeof session.tokenHash === "string" &&
    typeof session.label === "string"
  )
}

function load(): AuthFile {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(authPath(), "utf8")) as AuthFile
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error("unrecognized auth file")
    cache = { version: 1, sessions: parsed.sessions.filter(isStoredSession) }
  } catch {
    cache = { version: 1, sessions: [] }
  }
  return cache
}

function save(file: AuthFile): void {
  cache = file
  mkdirSync(hangarHome(), { recursive: true })
  writeFileSync(authPath(), JSON.stringify(file, null, 2) + "\n")
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function equalSecrets(a: string, b: string): boolean {
  // Hashing first keeps the comparison constant-length; timingSafeEqual throws otherwise.
  return timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"))
}

/** Rejection sampling keeps every glyph equally likely whatever the alphabet length. */
function pairingCode(): string {
  const limit = 256 - (256 % PAIRING_ALPHABET.length)
  let code = ""
  while (code.length < PAIRING_LENGTH) {
    for (const byte of randomBytes(PAIRING_LENGTH)) {
      if (byte >= limit) continue
      code += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]
      if (code.length === PAIRING_LENGTH) break
    }
  }
  return code
}

/** Mints a single-use pairing grant, invalidating any prior one. */
export function createPairingToken(): { token: string; expiresAt: number } {
  grant = { token: pairingCode(), expiresAt: Date.now() + PAIRING_TTL_MS }
  pairFailures = 0
  return { ...grant }
}

export function redeemPairingToken(token: unknown, label: unknown): PairResult {
  if (pairFailures >= MAX_PAIR_FAILURES) return { ok: false, reason: "locked" }
  const active = grant && grant.expiresAt > Date.now() ? grant : null
  if (typeof token !== "string" || !active || !equalSecrets(token, active.token)) {
    pairFailures += 1
    return { ok: false, reason: "invalid" }
  }
  grant = null
  pairFailures = 0

  const sessionToken = `hgr_${randomBytes(32).toString("base64url")}`
  const now = Date.now()
  const session: StoredSession = {
    id: randomBytes(8).toString("hex"),
    tokenHash: sha256(sessionToken),
    label: (typeof label === "string" ? label.trim() : "").slice(0, MAX_LABEL_LENGTH) || "paired machine",
    createdAt: now,
    lastSeenAt: now,
  }
  const file = load()
  save({ version: 1, sessions: [...file.sessions, session] })
  return { ok: true, sessionToken, sessionId: session.id }
}

/** Returns the session id behind a valid `Authorization: Bearer …` header, else null. */
export function verifyBearer(header: string | undefined): string | null {
  const match = /^bearer\s+(\S+)$/i.exec(header?.trim() ?? "")
  if (!match?.[1]) return null
  const hash = Buffer.from(sha256(match[1]), "hex")
  const session = load().sessions.find((candidate) => {
    const stored = Buffer.from(candidate.tokenHash, "hex")
    return stored.length === hash.length && timingSafeEqual(stored, hash)
  })
  if (!session) return null
  touch(session)
  return session.id
}

function touch(session: StoredSession): void {
  const now = Date.now()
  if (now - session.lastSeenAt < LAST_SEEN_THROTTLE_MS) return
  session.lastSeenAt = now
  save(load())
}

export function issueTicket(sessionId: string): { ticket: string; expiresAt: number } {
  const now = Date.now()
  for (const [value, entry] of tickets) if (entry.expiresAt <= now) tickets.delete(value)
  const ticket = randomBytes(32).toString("base64url")
  const expiresAt = now + TICKET_TTL_MS
  tickets.set(ticket, { sessionId, expiresAt })
  return { ticket, expiresAt }
}

/** Single use: a ticket is spent whether or not it was still valid. */
export function consumeTicket(ticket: string): string | null {
  const entry = tickets.get(ticket)
  if (!entry) return null
  tickets.delete(ticket)
  return entry.expiresAt > Date.now() ? entry.sessionId : null
}

export function listSessions(): AuthSessionInfo[] {
  return load().sessions.map(({ id, label, createdAt, lastSeenAt }) => ({ id, label, createdAt, lastSeenAt }))
}

export function revokeSession(id: string): boolean {
  const file = load()
  const sessions = file.sessions.filter((session) => session.id !== id)
  if (sessions.length === file.sessions.length) return false
  save({ version: 1, sessions })
  for (const [value, entry] of tickets) if (entry.sessionId === id) tickets.delete(value)
  return true
}
