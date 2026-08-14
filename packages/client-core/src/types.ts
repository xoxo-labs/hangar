/** One machine the UI talks to. The local connection is implicit and never persisted. */
export type ConnectionConfig = {
  /** Namespace for every id this connection owns; never contains ":". */
  id: string
  label: string
  host: string
  port: number
  /** Reserved: paired servers speak plaintext ws:// today (Tailscale is the recommended transport). */
  secure: boolean
  /** Session token from pairing; absent for the local connection. */
  token?: string
}

/** `blocked` means the saved token was rejected: no more retries until a wakeup. */
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "blocked"
