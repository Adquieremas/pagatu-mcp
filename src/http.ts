/**
 * Utilidades HTTP: CORS y respuestas JSON.
 *
 * CORS está abierto en origen porque un cliente MCP puede ser una extensión o
 * una app de escritorio sin origen estable, y porque aquí NO hay cookies: la
 * autorización es un Bearer explícito, así que un origen cualquiera no puede
 * actuar en nombre de nadie sin tener antes un token.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
  'Access-Control-Max-Age': '86400',
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function preflight(): Response {
  return withCors(new Response(null, { status: 204 }))
}

export function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return withCors(
    new Response(JSON.stringify(payload, null, 2), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    }),
  )
}

/** Error en formato JSON-RPC 2.0, que es lo que entiende un cliente MCP. */
export function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return jsonResponse({ jsonrpc: '2.0', error: { code, message }, id: null }, status, headers)
}
