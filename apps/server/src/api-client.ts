import type { PairResponse, PairingInfo, Project, ServerMsg, SessionInfo, WsTicketResponse } from "@hangar/contracts"
import type { CliTarget } from "./targets.ts"
import { targetBase } from "./targets.ts"

type StateMessage = Extract<ServerMsg, { type: "state" }>

type ApiErrorBody = { error?: unknown; code?: unknown }

export class ApiError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class HangarApi {
  readonly target: CliTarget
  readonly timeoutMs: number

  constructor(target: CliTarget, timeoutMs = 10_000) {
    this.target = target
    this.timeoutMs = timeoutMs
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (this.target.token) headers.set("authorization", `Bearer ${this.target.token}`)
    if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    let response: Response
    try {
      response = await fetch(`${targetBase(this.target)}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error), 0, "target_unreachable")
    }
    const text = await response.text()
    let body: unknown = null
    try {
      body = text === "" ? null : JSON.parse(text)
    } catch {
      body = text
    }
    if (!response.ok) {
      const errorBody = body as ApiErrorBody | null
      const message = typeof errorBody?.error === "string" ? errorBody.error : `request failed (${response.status})`
      const code =
        typeof errorBody?.code === "string"
          ? errorBody.code
          : response.status === 401
            ? "unauthorized"
            : "request_failed"
      throw new ApiError(message, response.status, code)
    }
    return body as T
  }

  state(): Promise<StateMessage> {
    return this.request<StateMessage>("/api/state")
  }

  sessions(): Promise<{ sessions: SessionInfo[] }> {
    return this.request("/api/sessions")
  }

  probe(): Promise<{ sessions: SessionInfo[] }> {
    return this.request("/api/sessions/probe", { method: "POST" })
  }

  session(action: "start" | "stop" | "restart", project: string, process?: string) {
    return this.request<{ changed: boolean; sessions: SessionInfo[] }>(`/api/sessions/${action}`, {
      method: "POST",
      body: JSON.stringify({ project, ...(process ? { process } : {}) }),
    })
  }

  logs(id: string): Promise<{ id: string; data: string }> {
    return this.request(`/api/logs?id=${encodeURIComponent(id)}`)
  }

  detect(path: string): Promise<unknown> {
    return this.request(`/project-info?path=${encodeURIComponent(path)}`)
  }

  upsertProject(project: Project): Promise<{ changed: boolean; project: Project }> {
    return this.request("/api/projects", { method: "POST", body: JSON.stringify({ project }) })
  }

  removeProject(name: string): Promise<{ changed: boolean; project: string }> {
    return this.request(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" })
  }

  pairingCode(): Promise<PairingInfo> {
    return this.request("/api/auth/pairing-code", { method: "POST" })
  }

  pair(code: string, label: string): Promise<PairResponse> {
    return this.request("/api/auth/pair", { method: "POST", body: JSON.stringify({ token: code, label }) })
  }

  revokeSelf(): Promise<{ revoked: boolean }> {
    return this.request("/api/auth/revoke-self", { method: "POST" })
  }

  ticket(): Promise<WsTicketResponse> {
    return this.request("/api/auth/ws-ticket", { method: "POST" })
  }
}
