/**
 * Dobles de prueba para Clerk y Convex.
 *
 * Nada de red: `fakeFetch` responde a las rutas de la Backend API de Clerk y
 * a `/api/query` y `/api/mutation` de Convex con el mismo formato de cable que
 * usan de verdad (`{ status: 'success', value }`), que es lo que hace que estos
 * tests sirvan para algo.
 */

import { vi } from 'vitest'
import type { Env } from '../src/env'

export const TEST_CONVEX_URL = 'https://test-deployment.convex.cloud'

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    CLERK_SECRET_KEY: 'sk_test_fake',
    CLERK_JWT_ISSUER_DOMAIN: 'https://clerk.pagatu.io',
    CLERK_API_URL: 'https://api.clerk.test',
    CONVEX_URL: TEST_CONVEX_URL,
    PAGATU_MCP_PUBLIC_URL: 'https://mcp.pagatu.io',
    PAGATU_APP_URL: 'https://app.pagatu.io',
    PAGATU_MCP_LOG_LEVEL: 'error',
    ...overrides,
  }
}

/** JWT sin firma real: solo necesita un `exp` legible para el caché. */
export function fakeJwt(expiresInSeconds = 60): string {
  const payload = { sub: 'user_123', exp: Math.floor(Date.now() / 1000) + expiresInSeconds }
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.firma-de-prueba`
}

export interface FakeBackend {
  /** Respuesta del endpoint de verificación de token OAuth. */
  verify?: { status?: number; body?: unknown }
  /** Sesiones activas que devuelve Clerk. */
  sessions?: Array<Record<string, unknown>>
  /** Respuesta del endpoint de token de plantilla. */
  templateToken?: { status?: number; body?: unknown }
  /** Resultados de Convex por ruta (`clients:listClients`). */
  convex?: Record<string, { value?: unknown; error?: string; errorData?: unknown }>
  calls: Array<{ url: string; body?: unknown }>
}

export function createFakeBackend(config: Partial<FakeBackend> = {}): FakeBackend {
  return {
    verify: { status: 200, body: { subject: 'user_123', client_id: 'client_abc', scopes: ['profile', 'email'] } },
    sessions: [{ id: 'sess_1', last_active_at: Date.now() }],
    templateToken: { status: 200, body: { jwt: fakeJwt() } },
    convex: {},
    calls: [],
    ...config,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function fakeFetch(backend: FakeBackend): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const rawBody = typeof init?.body === 'string' ? init.body : undefined
    const body = rawBody ? (JSON.parse(rawBody) as unknown) : undefined
    backend.calls.push({ url, ...(body !== undefined ? { body } : {}) })

    if (url.includes('/oauth_applications/access_tokens/verify')) {
      const { status = 200, body: payload } = backend.verify ?? {}
      return json(payload ?? {}, status)
    }

    if (url.includes('/v1/sessions?')) {
      return json({ data: backend.sessions ?? [] })
    }

    if (/\/v1\/sessions\/[^/]+\/tokens\//.test(url)) {
      const { status = 200, body: payload } = backend.templateToken ?? {}
      return json(payload ?? {}, status)
    }

    if (url.startsWith(TEST_CONVEX_URL)) {
      const path = (body as { path?: string } | undefined)?.path ?? ''
      const entry = backend.convex?.[path]
      if (!entry) return json({ status: 'error', errorMessage: `Función no simulada: ${path}` })
      if (entry.error !== undefined) {
        return json({
          status: 'error',
          errorMessage: entry.error,
          ...(entry.errorData !== undefined ? { errorData: entry.errorData } : {}),
        })
      }
      return json({ status: 'success', value: entry.value ?? null })
    }

    throw new Error(`fetch no simulado: ${url}`)
  }) as typeof fetch
}

export function stubFetch(backend: FakeBackend): void {
  vi.stubGlobal('fetch', fakeFetch(backend))
}

/** Petición JSON-RPC lista para el transporte Streamable HTTP. */
export function mcpRequest(payload: unknown, token = 'oauth_token_abc'): Request {
  return new Request('https://mcp.pagatu.io/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
}

export const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
}
