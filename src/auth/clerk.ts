/**
 * Cliente de la Backend API de Clerk.
 *
 * Hace exactamente dos cosas:
 *
 * 1. VERIFICA el access token OAuth que manda el cliente MCP
 *    (`POST /v1/oauth_applications/access_tokens/verify`) y devuelve de quién
 *    es. Ese endpoint es la única autoridad sobre si un token sirve: aquí no
 *    se valida ninguna firma a mano ni se confía en nada que venga del cliente.
 *
 * 2. FIRMA, para ese mismo usuario, un JWT del template `convex`
 *    (`POST /v1/sessions/{session_id}/tokens/{template}`). Es el mismo token
 *    que usa la app de Pagatu, así que Convex aplica al MCP las mismas reglas
 *    de identidad y de propiedad que al navegador. El Worker no tiene —ni
 *    necesita— una clave de administrador de Convex.
 *
 * Para firmar hace falta una SESIÓN de ese usuario. Al principio solo se
 * buscaban las sesiones de navegador ya abiertas, y eso estaba mal: quien
 * autorizaba el conector y luego cerraba Pagatu recibía «inicia sesión» en
 * todas las herramientas, para siempre. Un cliente MCP no tiene navegador y no
 * hay nada que el usuario pueda hacer desde el chat. Ahora, cuando no hay
 * ninguna sesión abierta, el Worker crea una él mismo con el par
 * `POST /v1/sign_in_tokens` (Backend API) + `strategy=ticket` contra la
 * Frontend API, que es la vía que Clerk da para esto en producción
 * (`POST /v1/sessions` crea sesiones, pero solo en instancias de desarrollo).
 *
 * Sigue siendo la identidad del usuario y nada más: el sign-in token se pide
 * para su `user_id`, dura un minuto y no concede nada que él no tuviera.
 *
 * El secreto de Clerk no sale de aquí.
 */

import type { Config } from '../env'
import type { Logger } from '../logging'
import { shortUserId } from '../logging'
import { PagatuSessionRequiredError, UpstreamError } from '../errors'
import { TtlCache, hashKey } from '../cache'

export interface VerifiedOAuthToken {
  /** `user_…` de Clerk: el dueño de los datos. */
  userId: string
  /** Cliente OAuth que pidió el token (Claude, Codex, …), si Clerk lo informa. */
  clientId?: string
  scopes: string[]
  /** Epoch ms de caducidad del access token, si Clerk lo informa. */
  expiresAt?: number
}

export interface ConvexSessionToken {
  jwt: string
  /** Epoch ms. Los tokens de plantilla de Clerk viven ~60 s. */
  expiresAt: number
}

/** Caducidad asumida cuando Clerk no informa `exp`. */
const DEFAULT_TEMPLATE_TOKEN_TTL_MS = 60_000
/** Margen de seguridad: no se reutiliza un token a punto de caducar. */
const TOKEN_SKEW_MS = 10_000
/** La verificación de un access token se cachea poco: es una decisión de permiso. */
const VERIFY_CACHE_TTL_MS = 30_000

const verifyCache = new TtlCache<VerifiedOAuthToken>()
const convexTokenCache = new TtlCache<ConvexSessionToken>()

/** Solo para tests: deja los dos cachés vacíos. */
export function __clearAuthCaches(): void {
  verifyCache.clear()
  convexTokenCache.clear()
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean)
  return []
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function pickEpochMs(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Clerk devuelve segundos en los campos `*_at` de tokens.
      return value > 1e12 ? value : value * 1000
    }
  }
  return undefined
}

/**
 * Si un 404 de Clerk es «ese token OAuth no existe» y no «esa ruta no existe».
 *
 * Clerk devuelve `{ errors: [{ code: 'oauth_access_token_not_found' }] }`.
 */
async function isClerkTokenNotFound(response: Response): Promise<boolean> {
  const payload = (await response.json().catch(() => null)) as { errors?: unknown } | null
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  return errors.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { code?: unknown }).code === 'string' &&
      (item as { code: string }).code.includes('oauth_access_token'),
  )
}

/**
 * Saca `created_session_id` de la respuesta de la Frontend API.
 *
 * Viene envuelta (`{ response: {...}, client: {...} }`) y el envoltorio ha
 * cambiado de forma entre versiones de la API, así que se busca la clave donde
 * esté en vez de dar por buena una ruta concreta.
 */
export function findCreatedSessionId(payload: unknown, depth = 0): string | undefined {
  if (depth > 4 || typeof payload !== 'object' || payload === null) return undefined
  const row = payload as Record<string, unknown>
  const direct = row['created_session_id']
  if (typeof direct === 'string' && direct.length > 0) return direct
  for (const value of Object.values(row)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findCreatedSessionId(item, depth + 1)
        if (found) return found
      }
      continue
    }
    const found = findCreatedSessionId(value, depth + 1)
    if (found) return found
  }
  return undefined
}

/** Lee el `exp` de un JWT SIN verificarlo: solo para decidir cuánto cachearlo. */
export function readJwtExpiry(jwt: string): number | undefined {
  const payload = jwt.split('.')[1]
  if (!payload) return undefined
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown }
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : undefined
  } catch {
    return undefined
  }
}

/**
 * `fetch` envuelto en una función propia.
 *
 * NO sustituir por `= fetch` a secas. En workerd, guardar el `fetch` global en
 * una propiedad y llamarlo como método (`this.fetchImpl(...)`) lanza
 * «Illegal invocation: function called with incorrect `this` reference», y
 * además solo en producción: en Node —y por tanto en los tests— el mismo
 * código funciona. Costó un 500 en vivo averiguarlo.
 *
 * La envoltura llama al global como global, así que da igual quién sea `this`.
 */
const globalFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)

export class ClerkBackendClient {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = globalFetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return await this.fetchImpl(`${this.config.clerkApiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.clerkSecretKey}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    })
  }

  /**
   * Verifica un access token OAuth contra Clerk.
   *
   * Devuelve `null` cuando Clerk dice que el token no vale (401/403/404 del
   * endpoint de verificación). Lanza `UpstreamError` cuando el que falla es
   * Clerk, porque «no sé» y «no» no pueden darse por la misma respuesta: lo
   * primero es un reintento, lo segundo es un 401 al cliente.
   */
  async verifyOAuthAccessToken(accessToken: string): Promise<VerifiedOAuthToken | null> {
    const cacheKey = await hashKey(accessToken)
    const cached = verifyCache.get(cacheKey)
    if (cached) return cached

    const body = JSON.stringify({ access_token: accessToken })
    let response = await this.request('/v1/oauth_applications/access_tokens/verify', { method: 'POST', body })

    // CUIDADO con el 404 de este endpoint: comprobado contra Clerk, un token
    // que no existe responde 404 con `code: oauth_access_token_not_found`, no
    // 401. Es decir, el 404 significa «ese token no vale» y NO «esa ruta no
    // existe». Solo si el cuerpo no es ese error de Clerk se prueba la ruta
    // sin prefijo de versión, por si una instancia la expone así.
    if (response.status === 404) {
      const clone = response.clone()
      if (!(await isClerkTokenNotFound(clone))) {
        response = await this.request('/oauth_applications/access_tokens/verify', { method: 'POST', body })
      }
    }

    if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 400) {
      this.logger.debug('clerk.verify.rejected', { status: response.status })
      return null
    }
    if (!response.ok) {
      this.logger.error('clerk.verify.failed', { status: response.status })
      throw new UpstreamError('clerk', 'No se pudo validar la autorización con Clerk. Vuelve a intentarlo.')
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!payload) throw new UpstreamError('clerk', 'Clerk devolvió una respuesta ilegible al validar el token.')

    const userId = pickString(payload, ['subject', 'user_id', 'userId', 'sub'])
    if (!userId) {
      this.logger.error('clerk.verify.no_subject')
      return null
    }

    const verified: VerifiedOAuthToken = {
      userId,
      ...(pickString(payload, ['client_id', 'clientId']) ? { clientId: pickString(payload, ['client_id', 'clientId']) } : {}),
      scopes: asArray(payload.scopes ?? payload.scope),
      ...(pickEpochMs(payload, ['expires_at', 'expiresAt', 'exp']) ? { expiresAt: pickEpochMs(payload, ['expires_at', 'expiresAt', 'exp']) } : {}),
    }

    const ttl = verified.expiresAt
      ? Math.min(VERIFY_CACHE_TTL_MS, Math.max(0, verified.expiresAt - Date.now() - TOKEN_SKEW_MS))
      : VERIFY_CACHE_TTL_MS
    verifyCache.set(cacheKey, verified, ttl)
    return verified
  }

  /**
   * Firma un JWT del template de Convex para el usuario dado.
   *
   * Primero intenta con las sesiones que el usuario ya tenga abiertas: si está
   * trabajando en Pagatu, no se crea nada. Si no hay ninguna, crea una sesión
   * para él (ver la cabecera del módulo) en vez de pedirle que abra el
   * navegador, porque desde un chat no puede hacerlo.
   *
   * `PagatuSessionRequiredError` queda para el caso que de verdad lo merece:
   * Clerk no deja crear la sesión, casi siempre porque la cuenta ya no está
   * activa.
   */
  async mintConvexToken(userId: string): Promise<ConvexSessionToken> {
    const cached = convexTokenCache.get(userId)
    if (cached) return cached

    const existing = await this.listActiveSessions(userId)
    const attempt = await this.signWithAnySession(userId, existing)
    if (attempt.token) return attempt.token
    if (attempt.templateMissing) {
      throw new UpstreamError(
        'clerk',
        `Clerk no tiene el JWT template «${this.config.convexJwtTemplate}». Créalo en el dashboard de Clerk para que el MCP pueda hablar con Convex.`,
      )
    }

    // Ninguna sesión abierta servía. Se crea una.
    const created = await this.createSessionForUser(userId)
    if (!created) {
      this.logger.info('clerk.session.none', { user: shortUserId(userId) })
      throw new PagatuSessionRequiredError(this.config.appUrl)
    }

    const second = await this.signWithAnySession(userId, [created])
    if (second.token) return second.token
    if (second.templateMissing) {
      throw new UpstreamError(
        'clerk',
        `Clerk no tiene el JWT template «${this.config.convexJwtTemplate}». Créalo en el dashboard de Clerk para que el MCP pueda hablar con Convex.`,
      )
    }

    this.logger.warn('clerk.template_token.failed', { user: shortUserId(userId) })
    throw new PagatuSessionRequiredError(this.config.appUrl)
  }

  /** Prueba a firmar el template con cada sesión hasta que una funcione. */
  private async signWithAnySession(
    userId: string,
    sessionIds: string[],
  ): Promise<{ token?: ConvexSessionToken; templateMissing: boolean }> {
    let templateMissing = false
    for (const sessionId of sessionIds) {
      const response = await this.request(
        `/v1/sessions/${encodeURIComponent(sessionId)}/tokens/${encodeURIComponent(this.config.convexJwtTemplate)}`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      if (!response.ok) {
        // 404 aquí = la plantilla no existe en esta instancia de Clerk. No es
        // un problema de sesión y reintentar con otra no arregla nada.
        if (response.status === 404) templateMissing = true
        this.logger.debug('clerk.template_token.rejected', { status: response.status })
        continue
      }
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
      const jwt = payload ? pickString(payload, ['jwt', 'token']) : undefined
      if (!jwt) continue
      const expiresAt = readJwtExpiry(jwt) ?? Date.now() + DEFAULT_TEMPLATE_TOKEN_TTL_MS
      const token: ConvexSessionToken = { jwt, expiresAt }
      convexTokenCache.set(userId, token, Math.max(0, expiresAt - Date.now() - TOKEN_SKEW_MS))
      return { token, templateMissing: false }
    }
    return { templateMissing }
  }

  /**
   * Crea una sesión de Clerk para el usuario, sin navegador.
   *
   * Dos pasos, los dos de Clerk:
   *   1. Backend API: `POST /v1/sign_in_tokens` con el `user_id`. Devuelve un
   *      ticket de un solo uso. Se pide con un minuto de vida: solo tiene que
   *      sobrevivir a la llamada siguiente.
   *   2. Frontend API (el propio issuer, p. ej. https://clerk.pagatu.io):
   *      `POST /v1/client/sign_ins` con `strategy=ticket`, formulario, no JSON.
   *      La respuesta trae `created_session_id`.
   *
   * Devuelve `null` —y no lanza— cuando Clerk se niega: quien llama decide qué
   * decirle al usuario. Un fallo aquí no debe parecer una caída del servidor.
   */
  private async createSessionForUser(userId: string): Promise<string | null> {
    const ticketResponse = await this.request('/v1/sign_in_tokens', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 60 }),
    })
    if (!ticketResponse.ok) {
      this.logger.warn('clerk.sign_in_token.failed', { user: shortUserId(userId), status: ticketResponse.status })
      return null
    }
    const ticketPayload = (await ticketResponse.json().catch(() => null)) as Record<string, unknown> | null
    const ticket = ticketPayload ? pickString(ticketPayload, ['token']) : undefined
    if (!ticket) {
      this.logger.warn('clerk.sign_in_token.no_token', { user: shortUserId(userId) })
      return null
    }

    const signInResponse = await this.fetchImpl(`${this.config.clerkIssuer}/v1/client/sign_ins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ strategy: 'ticket', ticket }).toString(),
    })
    if (!signInResponse.ok) {
      this.logger.warn('clerk.ticket_sign_in.failed', { user: shortUserId(userId), status: signInResponse.status })
      return null
    }
    const payload = (await signInResponse.json().catch(() => null)) as Record<string, unknown> | null
    const sessionId = findCreatedSessionId(payload)
    if (!sessionId) {
      this.logger.warn('clerk.ticket_sign_in.no_session', { user: shortUserId(userId) })
      return null
    }
    this.logger.info('clerk.session.created', { user: shortUserId(userId) })
    return sessionId
  }

  /** Ids de sesiones activas del usuario, de la más reciente a la más antigua. */
  private async listActiveSessions(userId: string): Promise<string[]> {
    const query = new URLSearchParams({ user_id: userId, status: 'active', limit: '10' })
    const response = await this.request(`/v1/sessions?${query.toString()}`)
    if (!response.ok) {
      this.logger.error('clerk.sessions.failed', { status: response.status })
      throw new UpstreamError('clerk', 'No se pudieron leer las sesiones de Clerk. Vuelve a intentarlo.')
    }
    const payload = (await response.json().catch(() => null)) as unknown
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown } | null)?.data)
        ? ((payload as { data: unknown[] }).data)
        : []

    return rows
      .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
      .map((row) => ({
        id: pickString(row, ['id']),
        // Se prefiere la sesión usada más recientemente: es la que más
        // probabilidades tiene de seguir viva cuando Clerk firme el token.
        seen: pickEpochMs(row, ['last_active_at', 'updated_at', 'created_at']) ?? 0,
      }))
      .filter((row): row is { id: string; seen: number } => typeof row.id === 'string')
      .sort((a, b) => b.seen - a.seen)
      .map((row) => row.id)
  }
}
