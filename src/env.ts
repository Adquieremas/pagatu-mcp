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
  constructor(missing: string[]) {
    super(`Configuración incompleta del Worker: faltan ${missing.join(', ')}`)
    this.name = 'ConfigError'
    this.missing = missing
  }
}

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
