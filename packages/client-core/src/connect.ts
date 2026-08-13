/**
 * The connect sequence, as platform-free helpers over global `fetch`: a paired
 * machine hands out a single-use WS ticket for a bearer token, the local one is
 * trusted on sight. Everything here is pure string work plus one HTTP call, so
 * the browser manager and the mobile manager can share it verbatim.
 */

import type { WsTicketResponse } from "@hangar/contracts"
import type { ConnectionConfig } from "./types.ts"

/** `http://host:port` — the origin every HTTP call to a machine hangs off. */
export function httpBase(config: ConnectionConfig): string {
  return `${config.secure ? "https" : "http"}://${config.host}:${config.port}`
}

/**
 * Why a ticket request failed, in the only two flavours a retry loop cares
 * about: `blocked` means the machine rejected our credential (401/403) and no
 * amount of retrying will help, anything else is transient (offline, 5xx,
 * garbled body) and worth another attempt.
 */
export class TicketError extends Error {
  blocked: boolean

  constructor(message: string, blocked: boolean, options?: ErrorOptions) {
    super(message, options)
    this.name = "TicketError"
    this.blocked = blocked
  }
}

/** Narrows the one failure a retry cannot fix: the saved token is gone. */
export function isBlocked(error: unknown): error is TicketError {
  return error instanceof TicketError && error.blocked
}

/**
 * Trades the saved session token for a single-use WS ticket. Always rejects
 * with a `TicketError`; read `.blocked` to tell "pair again" from "try again".
 */
export async function fetchWsTicket(config: ConnectionConfig): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${httpBase(config)}/api/auth/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token ?? ""}` },
    })
  } catch (error) {
    throw new TicketError(`Could not reach ${httpBase(config)}`, false, { cause: error })
  }
  if (response.status === 401 || response.status === 403) {
    throw new TicketError("This machine rejected the saved pairing. Pair again to reconnect.", true)
  }
  if (!response.ok) throw new TicketError(`Ticket request failed (${response.status})`, false)
  let body: WsTicketResponse
  try {
    body = (await response.json()) as WsTicketResponse
  } catch (error) {
    throw new TicketError("Malformed ticket response", false, { cause: error })
  }
  if (typeof body.ticket !== "string" || body.ticket === "") throw new TicketError("Malformed ticket response", false)
  return body.ticket
}

/**
 * The socket URL for a machine. A ticket is appended when one was needed; the
 * local (loopback) connection has no token, so it connects without one.
 */
export function wsUrl(config: ConnectionConfig, ticket?: string): string {
  const base = `${config.secure ? "wss" : "ws"}://${config.host}:${config.port}/ws`
  if (ticket === undefined || ticket === "") return base
  return `${base}?ticket=${encodeURIComponent(ticket)}`
}
