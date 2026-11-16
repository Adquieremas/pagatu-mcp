/**
 * Errores del servidor MCP y traducción de los errores de Convex.
 *
 * Dos reglas:
 *
 * 1. Lo que viaja al cliente MCP es un CÓDIGO estable y una frase accionable
 *    en español. Nunca un stack, nunca el mensaje crudo de la base.
 * 2. Un documento que no existe y uno que es de otra cuenta dan el MISMO
 *    error (`NOT_FOUND`). Distinguirlos revelaría qué ids existen en otras
 *    cuentas, que es justo lo que este servidor no debe filtrar.
 */

/** Error con representación HTTP (capa de transporte/OAuth). */
export class HttpError extends Error {
  readonly status: number
  readonly headers: Record<string, string>
  readonly code: string

  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.headers = headers
  }
}

/** 401: falta el Bearer, está mal formado, caducó o Clerk lo rechazó. */
export class UnauthorizedError extends HttpError {
  constructor(message: string, wwwAuthenticate: string) {
    super(401, 'unauthorized', message, { 'WWW-Authenticate': wwwAuthenticate })
    this.name = 'UnauthorizedError'
  }
}

/** 403: token válido, pero sin permiso para esta operación. */
export class ForbiddenError extends HttpError {
  constructor(message: string, code = 'forbidden') {
    super(403, code, message)
    this.name = 'ForbiddenError'
  }
}

/** Error de herramienta: llega al modelo como resultado `isError`, no como 5xx. */
export class ToolError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ToolError'
    this.code = code
    this.details = details
  }
}

/** Convex o Clerk respondieron mal: ni culpa del usuario ni del modelo. */
export class UpstreamError extends ToolError {
  constructor(service: 'clerk' | 'convex', message: string, details?: Record<string, unknown>) {
    super(`${service}_unavailable`, message, details)
    this.name = 'UpstreamError'
  }
}

/**
 * No hay sesión de Clerk viva con la que firmar un token para Convex.
 *
 * No es un fallo: es el caso normal cuando alguien autorizó el MCP hace días
 * y desde entonces no abrió Pagatu. El mensaje tiene que decir exactamente
 * qué hacer, porque el modelo lo va a repetir tal cual.
 */
export class PagatuSessionRequiredError extends ToolError {
  constructor(appUrl: string) {
    super(
      'pagatu_session_required',
      `No hay una sesión activa de Pagatu para esta cuenta. Inicia sesión en ${appUrl} y vuelve a intentarlo.`,
      { appUrl },
    )
    this.name = 'PagatuSessionRequiredError'
  }
}

/** Códigos de Convex que SÍ se devuelven tal cual, con su frase en español. */
const CONVEX_CODE_MESSAGES: Record<string, string> = {
  PLAN_LIMIT_CLIENTS: 'Alcanzaste el límite de clientes de tu plan en Pagatu.',
  PLAN_LIMIT_DOCUMENTS: 'Alcanzaste el límite de documentos de tu plan en Pagatu.',
  PLAN_LIMIT_INVOICES: 'Alcanzaste el límite de facturas de tu plan en Pagatu.',
  CONTENT_LOCKED: 'El documento está bloqueado porque ya tiene una aceptación registrada.',
  INVOICE_LOCKED: 'La factura ya fue emitida y no admite este cambio.',
  NOT_AUTHENTICATED: 'Convex no reconoció la sesión del usuario.',
  PROFILE_FIELD_TOO_LONG: 'Uno de los campos supera el máximo permitido.',
  PROFILE_FIELD_INVALID_COLOR: 'Un color del kit de marca no es un hexadecimal válido.',
}

type ConvexErrorLike = { data?: unknown; message?: unknown }

/** El `data.code` de un `ConvexError`, si lo trae. */
function convexErrorCode(error: unknown): string | null {
  const data = (error as ConvexErrorLike | null)?.data
  if (typeof data === 'string') return data.split(':')[0] ?? null
  if (data && typeof data === 'object' && 'code' in data) {
    const code = (data as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return null
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

/**
 * Traduce cualquier cosa que lance Convex a un `ToolError`.
 *
 * El orden importa: primero el código estructurado (`ConvexError`), luego los
 * mensajes que Pagatu lanza como texto (`CLIENT_DUPLICATE:…`, «not found or
 * access denied»), y solo al final el genérico.
 */
export function toToolError(error: unknown, appUrl: string): ToolError {
  if (error instanceof ToolError) return error

  const code = convexErrorCode(error)
  if (code) {
    const known = CONVEX_CODE_MESSAGES[code]
    if (known) return new ToolError(code.toLowerCase(), known, { convexCode: code })
    return new ToolError(code.toLowerCase(), `Pagatu rechazó la operación (${code}).`, { convexCode: code })
  }

  const raw = messageOf(error)

  if (raw.startsWith('CLIENT_DUPLICATE:')) {
    const [, field, name] = raw.split(':')
    return new ToolError(
      'client_duplicate',
      `Ya existe un cliente con el mismo ${field ?? 'dato'}${name ? ` (${name})` : ''}. ` +
        'Usa allowDuplicate=true si de verdad quieres crear otro.',
      { field, existingName: name },
    )
  }

  if (/not authenticated|NOT_AUTHENTICATED|Unauthenticated/i.test(raw)) {
    return new PagatuSessionRequiredError(appUrl)
  }

  if (/not found or access denied|no encontrado/i.test(raw)) {
    return new ToolError('not_found', 'No existe ese registro en tu cuenta de Pagatu.')
  }

  for (const [convexCode, message] of Object.entries(CONVEX_CODE_MESSAGES)) {
    if (raw.includes(convexCode)) {
      return new ToolError(convexCode.toLowerCase(), message, { convexCode })
    }
  }

  return new UpstreamError('convex', 'Pagatu no pudo completar la operación. Vuelve a intentarlo en unos segundos.')
}
