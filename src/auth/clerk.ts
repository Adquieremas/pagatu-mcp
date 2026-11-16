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
 * 2. FIRMA, para ese mismo usuario, un JWT del template `convex` a partir de
 *    su sesión activa de Clerk
 *    (`POST /v1/sessions/{session_id}/tokens/{template}`). Es el mismo token
 *    que usa la app de Pagatu, así que Convex aplica al MCP las mismas reglas
 *    de identidad y de propiedad que al navegador. El Worker no tiene —ni
 *    necesita— una clave de administrador de Convex.
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
   * Necesita una sesión activa de Clerk de ese usuario, que es lo mismo que
   * necesita la app. Si no hay ninguna (nadie abrió Pagatu en días), lanza
   * `PagatuSessionRequiredError` con la instrucción concreta: iniciar sesión.
   */
  async mintConvexToken(userId: string): Promise<ConvexSessionToken> {
    const cached = convexTokenCache.get(userId)
    if (cached) return cached

    const sessions = await this.listActiveSessions(userId)
    if (sessions.length === 0) {
      this.logger.info('clerk.session.none', { user: shortUserId(userId) })
      throw new PagatuSessionRequiredError(this.config.appUrl)
    }

    let lastStatus = 0
    for (const sessionId of sessions) {
      const response = await this.request(
        `/v1/sessions/${encodeURIComponent(sessionId)}/tokens/${encodeURIComponent(this.config.convexJwtTemplate)}`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      if (!response.ok) {
        lastStatus = response.status
        this.logger.debug('clerk.template_token.rejected', { status: response.status })
        continue
      }
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
      const jwt = payload ? pickString(payload, ['jwt', 'token']) : undefined
      if (!jwt) {
        lastStatus = 500
        continue
      }
      const expiresAt = readJwtExpiry(jwt) ?? Date.now() + DEFAULT_TEMPLATE_TOKEN_TTL_MS
      const token: ConvexSessionToken = { jwt, expiresAt }
      convexTokenCache.set(userId, token, Math.max(0, expiresAt - Date.now() - TOKEN_SKEW_MS))
      return token
    }

    this.logger.warn('clerk.template_token.failed', { user: shortUserId(userId), status: lastStatus })
    // 404 del endpoint de plantilla = la plantilla no existe en esa instancia.
    if (lastStatus === 404) {
      throw new UpstreamError(
        'clerk',
        `Clerk no tiene el JWT template «${this.config.convexJwtTemplate}». Créalo en el dashboard de Clerk para que el MCP pueda hablar con Convex.`,
      )
    }
    throw new PagatuSessionRequiredError(this.config.appUrl)
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
