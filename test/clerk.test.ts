import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/env'
import { createLogger } from '../src/logging'
import { ClerkBackendClient, __clearAuthCaches, readJwtExpiry } from '../src/auth/clerk'
import { PagatuSessionRequiredError, UpstreamError } from '../src/errors'
import { createFakeBackend, fakeFetch, fakeJwt, stubFetch, testEnv } from './helpers'

const config = resolveConfig(testEnv())
const logger = createLogger('error')

function client(backend = createFakeBackend()) {
  return { clerk: new ClerkBackendClient(config, logger, fakeFetch(backend)), backend }
}

beforeEach(() => __clearAuthCaches())
afterEach(() => vi.unstubAllGlobals())

describe('verifyOAuthAccessToken', () => {
  it('devuelve el usuario, el cliente OAuth y los scopes', async () => {
    const { clerk } = client()
    const verified = await clerk.verifyOAuthAccessToken('tok_1')
    expect(verified).toEqual({ userId: 'user_123', clientId: 'client_abc', scopes: ['profile', 'email'] })
  })

  it('funciona sin fetch inyectado, usando el global', async () => {
    // El `fetch` por defecto se envuelve a propósito: en workerd, llamar al
    // global guardado en una propiedad («this.fetchImpl(...)») lanza «Illegal
    // invocation». Node no lo reproduce, así que este test fija la intención
    // y la comprobación de verdad es la sonda contra el Worker desplegado.
    stubFetch(createFakeBackend())
    const clerk = new ClerkBackendClient(config, logger)
    expect((await clerk.verifyOAuthAccessToken('tok_1'))?.userId).toBe('user_123')
  })

  it('acepta `user_id` y `scope` como cadena (variantes de Clerk)', async () => {
    const { clerk } = client(
      createFakeBackend({ verify: { body: { user_id: 'user_999', scope: 'profile email' } } }),
    )
    const verified = await clerk.verifyOAuthAccessToken('tok_1')
    expect(verified?.userId).toBe('user_999')
    expect(verified?.scopes).toEqual(['profile', 'email'])
  })

  it('un token rechazado por Clerk es null, no una excepción', async () => {
    const { clerk } = client(createFakeBackend({ verify: { status: 401, body: { errors: [] } } }))
    expect(await clerk.verifyOAuthAccessToken('tok_malo')).toBeNull()
  })

  it('un 404 con `oauth_access_token_not_found` es token inválido, no ruta mala', async () => {
    // Comprobado contra Clerk: así responde un token OAuth que no existe.
    const backend = createFakeBackend({
      verify: {
        status: 404,
        body: { errors: [{ message: 'OAuth Access Token not found', code: 'oauth_access_token_not_found' }] },
      },
    })
    const { clerk } = client(backend)
    expect(await clerk.verifyOAuthAccessToken('tok_inexistente')).toBeNull()
    // Y no se gasta una segunda llamada probando la ruta sin /v1.
    expect(backend.calls.filter((call) => call.url.includes('verify'))).toHaveLength(1)
  })

  it('un 404 que NO es de Clerk reintenta la ruta sin prefijo de versión', async () => {
    const backend = createFakeBackend({ verify: { status: 404, body: { message: 'not found' } } })
    const { clerk } = client(backend)
    expect(await clerk.verifyOAuthAccessToken('tok_1')).toBeNull()
    const [primera, segunda] = backend.calls.filter((call) => call.url.includes('verify'))
    expect(primera?.url).toContain('/v1/oauth_applications')
    expect(segunda?.url).not.toContain('/v1/')
  })

  it('un fallo de Clerk NO se confunde con un token inválido', async () => {
    const { clerk } = client(createFakeBackend({ verify: { status: 500, body: {} } }))
    await expect(clerk.verifyOAuthAccessToken('tok_1')).rejects.toBeInstanceOf(UpstreamError)
  })

  it('una verificación sin `subject` no autentica a nadie', async () => {
    const { clerk } = client(createFakeBackend({ verify: { body: { scopes: ['profile'] } } }))
    expect(await clerk.verifyOAuthAccessToken('tok_1')).toBeNull()
  })

  it('no vuelve a preguntar a Clerk por el mismo token', async () => {
    const { clerk, backend } = client()
    await clerk.verifyOAuthAccessToken('tok_1')
    await clerk.verifyOAuthAccessToken('tok_1')
    const verifyCalls = backend.calls.filter((call) => call.url.includes('verify'))
    expect(verifyCalls).toHaveLength(1)
  })

  it('el token NO viaja como clave de caché en claro', async () => {
    const { clerk, backend } = client()
    await clerk.verifyOAuthAccessToken('tok_secreto')
    // La única vez que el token sale de aquí es dentro del cuerpo de la
    // verificación, que es su destino legítimo.
    const bodies = backend.calls.map((call) => JSON.stringify(call.body ?? {}))
    expect(bodies.filter((body) => body.includes('tok_secreto'))).toHaveLength(1)
  })
})

describe('mintConvexToken', () => {
  it('firma el JWT del template de la sesión más reciente', async () => {
    const backend = createFakeBackend({
      sessions: [
        { id: 'sess_vieja', last_active_at: 1000 },
        { id: 'sess_nueva', last_active_at: 2000 },
      ],
    })
    const { clerk } = client(backend)
    const token = await clerk.mintConvexToken('user_123')
    expect(token.jwt).toContain('.')
    const tokenCall = backend.calls.find((call) => call.url.includes('/tokens/'))
    expect(tokenCall?.url).toContain('/v1/sessions/sess_nueva/tokens/convex')
  })

  it('sin sesión activa pide iniciar sesión en Pagatu', async () => {
    const { clerk } = client(createFakeBackend({ sessions: [] }))
    await expect(clerk.mintConvexToken('user_123')).rejects.toBeInstanceOf(PagatuSessionRequiredError)
  })

  it('si la plantilla no existe en Clerk, lo dice en claro', async () => {
    const { clerk } = client(createFakeBackend({ templateToken: { status: 404, body: {} } }))
    await expect(clerk.mintConvexToken('user_123')).rejects.toThrowError(/JWT template/)
  })

  it('prueba la siguiente sesión si una no sirve', async () => {
    const backend = createFakeBackend({
      sessions: [
        { id: 'sess_a', last_active_at: 2000 },
        { id: 'sess_b', last_active_at: 1000 },
      ],
    })
    let intentos = 0
    const base = fakeFetch(backend)
    const clerk = new ClerkBackendClient(config, logger, (async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/tokens/')) {
        intentos += 1
        if (intentos === 1) return new Response('{}', { status: 401 })
      }
      return base(input as RequestInfo, init)
    }) as typeof fetch)

    const token = await clerk.mintConvexToken('user_123')
    expect(token.jwt).toBeTruthy()
    expect(intentos).toBe(2)
  })

  it('reutiliza el token mientras no caduque', async () => {
    const { clerk, backend } = client()
    await clerk.mintConvexToken('user_123')
    await clerk.mintConvexToken('user_123')
    expect(backend.calls.filter((call) => call.url.includes('/tokens/'))).toHaveLength(1)
  })
})

describe('readJwtExpiry', () => {
  it('lee el exp sin verificar la firma', () => {
    const expiry = readJwtExpiry(fakeJwt(120))
    expect(expiry).toBeGreaterThan(Date.now())
  })

  it('devuelve undefined ante basura', () => {
    expect(readJwtExpiry('no-es-un-jwt')).toBeUndefined()
    expect(readJwtExpiry('a.b.c')).toBeUndefined()
  })
})
