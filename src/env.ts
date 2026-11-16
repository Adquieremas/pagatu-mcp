/**
 * Variables de entorno del Worker y su validación.
 *
 * Nada aquí tiene valor por defecto si es un secreto: si falta, el Worker
 * responde 503 con el nombre exacto de la variable que falta en lugar de
 * fallar a mitad de una llamada MCP.
 */

export interface Env {
  /** Secreto de Clerk (sk_live_… / sk_test_…). `wrangler secret put CLERK_SECRET_KEY`. */
  CLERK_SECRET_KEY?: string
  /** Issuer del instance de Clerk, p. ej. https://clerk.pagatu.io */
  CLERK_JWT_ISSUER_DOMAIN?: string
  /** Base de la Backend API de Clerk. Solo se cambia en tests. */
  CLERK_API_URL?: string
  /** Nombre del JWT template de Clerk que entiende Convex. Por defecto `convex`. */
  CLERK_CONVEX_JWT_TEMPLATE?: string
  /** URL del despliegue Convex de Pagatu, p. ej. https://xxx.convex.cloud */
  CONVEX_URL?: string
  /** URL pública de este Worker (se publica en los metadatos OAuth). */
  PAGATU_MCP_PUBLIC_URL?: string
  /** URL de la app de Pagatu (se usa en mensajes de error accionables). */
  PAGATU_APP_URL?: string
  /** `false` deja el servidor en modo solo lectura (no registra herramientas de escritura). */
  PAGATU_MCP_WRITE_ENABLED?: string
  /** Lista de client_id de OAuth permitidos, separados por comas. Vacío = todos. */
  PAGATU_MCP_ALLOWED_CLIENT_IDS?: string
  /** `debug` | `info` | `warn` | `error`. Por defecto `info`. */
  PAGATU_MCP_LOG_LEVEL?: string
}

export interface Config {
  clerkSecretKey: string
  clerkIssuer: string
  clerkApiUrl: string
  convexJwtTemplate: string
  convexUrl: string
  publicUrl: string
  appUrl: string
  writeEnabled: boolean
  allowedClientIds: string[]
  logLevel: LogLevel
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export class ConfigError extends Error {
  readonly missing: string[]
  /** Variables presentes pero con un valor que no puede funcionar. */
  readonly invalid: string[]

  constructor(missing: string[], invalid: Array<{ name: string; reason: string }> = []) {
    const partes: string[] = []
    if (missing.length > 0) partes.push(`faltan ${missing.join(', ')}`)
    for (const { name, reason } of invalid) partes.push(`${name}: ${reason}`)
    super(`Configuración del Worker incorrecta — ${partes.join(' · ')}`)
    this.name = 'ConfigError'
    this.missing = missing
    this.invalid = invalid.map((item) => item.name)
  }
}

/**
 * Una clave secreta de Clerk de verdad: `sk_test_`/`sk_live_` y después solo
 * caracteres de token.
 *
 * Esto existe por un fallo real en producción: el dashboard de Clerk muestra la
 * clave ENMASCARADA (`sk_live_S…weG2`, con un «…» literal), y copiarla de ahí
 * deja un secreto que Clerk rechaza con 401. El MCP lo traducía en «tu token no
 * vale» y señalaba al cliente MCP en vez de a la configuración — media hora de
 * buscar en el sitio equivocado. Ahora el Worker se niega a arrancar la petición
 * y dice exactamente qué pasa.
 */
const CLERK_SECRET_PATTERN = /^sk_(test|live)_[A-Za-z0-9_-]{16,}$/

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

function trimmed(value: string | undefined): string | undefined {
  const out = value?.trim()
  return out ? out : undefined
}

/** Quita la barra final para que las URLs se concatenen sin dobles barras. */
function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const raw = trimmed(value)?.toLowerCase()
  if (raw === undefined) return fallback
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return fallback
}

function parseLogLevel(value: string | undefined): LogLevel {
  const raw = trimmed(value)?.toLowerCase()
  return LOG_LEVELS.includes(raw as LogLevel) ? (raw as LogLevel) : 'info'
}

/**
 * Valida el entorno UNA vez por petición y devuelve una configuración ya
 * normalizada. Lanza `ConfigError` con la lista completa de lo que falta —no
 * la primera variable— para que un despliegue mal configurado se arregle de
 * una sola pasada.
 */
export function resolveConfig(env: Env): Config {
  const missing: string[] = []
  const clerkSecretKey = trimmed(env.CLERK_SECRET_KEY)
  if (!clerkSecretKey) missing.push('CLERK_SECRET_KEY')
  const clerkIssuer = trimmed(env.CLERK_JWT_ISSUER_DOMAIN)
  if (!clerkIssuer) missing.push('CLERK_JWT_ISSUER_DOMAIN')
  const convexUrl = trimmed(env.CONVEX_URL)
  if (!convexUrl) missing.push('CONVEX_URL')
  const publicUrl = trimmed(env.PAGATU_MCP_PUBLIC_URL)
  if (!publicUrl) missing.push('PAGATU_MCP_PUBLIC_URL')
  if (missing.length > 0) throw new ConfigError(missing)

  const invalid: Array<{ name: string; reason: string }> = []
  if (!CLERK_SECRET_PATTERN.test(clerkSecretKey as string)) {
    const enmascarada = /[……*]/.test(clerkSecretKey as string)
    invalid.push({
      name: 'CLERK_SECRET_KEY',
      reason: enmascarada
        ? 'parece la clave ENMASCARADA del dashboard de Clerk (contiene «…» o «*»). Copia la clave completa con el botón de copiar y vuelve a cargarla con `wrangler secret put CLERK_SECRET_KEY`.'
        : 'no tiene el formato de una clave secreta de Clerk (sk_test_… o sk_live_…).',
    })
  }
  if (invalid.length > 0) throw new ConfigError([], invalid)

  return {
    clerkSecretKey: clerkSecretKey as string,
    clerkIssuer: normalizeUrl(clerkIssuer as string),
    clerkApiUrl: normalizeUrl(trimmed(env.CLERK_API_URL) ?? 'https://api.clerk.com'),
    convexJwtTemplate: trimmed(env.CLERK_CONVEX_JWT_TEMPLATE) ?? 'convex',
    convexUrl: normalizeUrl(convexUrl as string),
    publicUrl: normalizeUrl(publicUrl as string),
    appUrl: normalizeUrl(trimmed(env.PAGATU_APP_URL) ?? 'https://app.pagatu.io'),
    writeEnabled: parseBoolean(env.PAGATU_MCP_WRITE_ENABLED, true),
    allowedClientIds: (trimmed(env.PAGATU_MCP_ALLOWED_CLIENT_IDS) ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    logLevel: parseLogLevel(env.PAGATU_MCP_LOG_LEVEL),
  }
}
