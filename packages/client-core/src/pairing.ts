/** Parsing and formatting for the pairing strings the Connections settings trade in. */

export type PairingAddress = { host: string; port: number; code: string }

/**
 * Reads `host:port#CODE`, the string the pairing panel offers for copying. A URL
 * form (`http://host:port/#CODE`) is accepted too, since that is what a browser
 * hands back from an address bar, and the code may be missing when only the
 * address was pasted.
 */
export function parsePairingString(input: string): PairingAddress | null {
  const trimmed = input.trim()
  if (trimmed === "") return null
  const hash = trimmed.indexOf("#")
  const code =
    hash === -1
      ? ""
      : trimmed
          .slice(hash + 1)
          .trim()
          .toUpperCase()
  const address = (hash === -1 ? trimmed : trimmed.slice(0, hash))
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/.*$/, "")
  // The last colon separates the port; anything before it is the host, brackets included.
  const colon = address.lastIndexOf(":")
  if (colon === -1) return null
  const host = address.slice(0, colon).trim()
  const port = Number.parseInt(address.slice(colon + 1), 10)
  if (host === "" || !Number.isInteger(port) || port <= 0 || port > 65_535) return null
  return { host, port, code }
}

/** The string a machine offers for pairing: address plus one-time code. */
export function pairingString(host: string, port: number, code: string): string {
  return `${host}:${port}#${code}`
}

/** `4:32` — how long a pairing code is still good for. Clamped at zero. */
export function countdown(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1_000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}
