/**
 * Every server-owned identifier is namespaced per connection at the WS seam, so
 * one store can hold N machines without their ids colliding. Connection ids
 * never contain ":", which is what makes the split unambiguous.
 */

export const LOCAL_CONN_ID = "local"

const SEPARATOR = "::"

export function scoped(connId: string, value: string): string {
  return `${connId}${SEPARATOR}${value}`
}

/** A bare value (deep link, `?window=` flow, App Intents URL) belongs to the local machine. */
export function parseScoped(value: string): { connId: string; value: string } {
  const at = value.indexOf(SEPARATOR)
  if (at === -1) return { connId: LOCAL_CONN_ID, value }
  return { connId: value.slice(0, at), value: value.slice(at + SEPARATOR.length) }
}

export function connIdOf(value: string): string {
  return parseScoped(value).connId
}

/** The bare, server-side name — what the UI renders. */
export function displayName(value: string): string {
  return parseScoped(value).value
}
