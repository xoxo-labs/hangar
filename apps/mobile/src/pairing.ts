/**
 * Redeeming a pairing code: the phone posts the one-time code to the machine
 * that minted it and keeps the session token it gets back. Same endpoint and the
 * same error wording as the desktop app's Connections settings.
 */

import { httpBase } from "@hangar/client-core"
import type { PairRequest, PairResponse } from "@hangar/contracts"

export type PairTarget = { host: string; port: number; code: string }

export type PairOutcome = { ok: true; token: string; serverName: string } | { ok: false; message: string }

/** Turns a refusal into the sentence the user reads. */
export function pairError(status: number): string {
  if (status === 401) return "That code is wrong or has expired. Make a new one on your Mac."
  if (status === 429) return "That Mac stopped accepting codes after too many tries. Make a fresh code there."
  return `That Mac refused the pairing (${status}).`
}

export const UNREACHABLE = "Could not reach that Mac. Check the address, and that it lets other machines connect."

/** Validates what the fields hold; null means "not enough to try yet". */
export function readTarget(host: string, port: string, code: string): PairTarget | null {
  const address = host.trim()
  const number = Number.parseInt(port, 10)
  const token = code.trim().toUpperCase()
  if (address === "" || !Number.isInteger(number) || number <= 0 || number > 65_535 || token === "") return null
  return { host: address, port: number, code: token }
}

export async function pair(target: PairTarget, label: string): Promise<PairOutcome> {
  const base = httpBase({ id: "", label: "", host: target.host, port: target.port, secure: false })
  let response: Response
  try {
    response = await fetch(`${base}/api/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: target.code, label } satisfies PairRequest),
    })
  } catch {
    return { ok: false, message: UNREACHABLE }
  }
  if (!response.ok) return { ok: false, message: pairError(response.status) }
  let body: PairResponse
  try {
    body = (await response.json()) as PairResponse
  } catch {
    return { ok: false, message: "That Mac sent back something Hangar could not read." }
  }
  if (typeof body.sessionToken !== "string" || body.sessionToken === "") {
    return { ok: false, message: "That Mac sent back something Hangar could not read." }
  }
  return { ok: true, token: body.sessionToken, serverName: body.serverName }
}
