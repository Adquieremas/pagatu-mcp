/**
 * De un `Authorization: Bearer …` a una identidad de Pagatu.
 *
 * El token NUNCA se interpreta aquí: lo verifica Clerk. Lo que este módulo
 * aporta es el contrato de la petición —qué cabeceras se aceptan, qué 401 se
 * devuelve— y la lista de clientes OAuth permitidos.
 */

import type { Config } from '../env'
import type { Logger } from '../logging'
import { shortUserId } from '../logging'
import { ForbiddenError, UnauthorizedError } from '../errors'
import { ClerkBackendClient } from './clerk'
import { wwwAuthenticate } from './metadata'

export interface AuthContext {
  userId: string
  clientId?: string
  scopes: string[]
}

export function extractBearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token ? token : null
}

/**
 * Autentica la petición o lanza el 401/403 correspondiente.
 *
 * Tres respuestas distintas, a propósito:
 * - sin token o token inválido → 401 con el enlace de metadatos (así el
 *   cliente MCP arranca el flujo OAuth solo);
 * - cliente OAuth no permitido → 403 (el token es bueno, la app no);
 * - Clerk caído → el `UpstreamError` sube y se convierte en 503, nunca en 401,
 *   para que un cliente no borre su autorización por una caída nuestra.
 */
export async function authenticateRequest(
  request: Request,
  config: Config,
  logger: Logger,
  clerk: ClerkBackendClient = new ClerkBackendClient(config, logger),
): Promise<AuthContext> {
  const token = extractBearer(request)
  if (!token) {
    throw new UnauthorizedError(
      'Falta el token de acceso. Autoriza el servidor MCP de Pagatu con tu cuenta.',
      wwwAuthenticate(config, 'missing access token'),
    )
  }

  const verified = await clerk.verifyOAuthAccessToken(token)
  if (!verified) {
    throw new UnauthorizedError(
      'El token de acceso no es válido o caducó. Vuelve a autorizar el servidor MCP de Pagatu.',
      wwwAuthenticate(config, 'invalid or expired access token'),
    )
  }

  if (config.allowedClientIds.length > 0) {
    if (!verified.clientId || !config.allowedClientIds.includes(verified.clientId)) {
      logger.warn('auth.client_not_allowed', { clientId: verified.clientId ?? 'unknown' })
      throw new ForbiddenError(
        'Esta aplicación no está autorizada a usar el MCP de Pagatu.',
        'client_not_allowed',
      )
    }
  }

  logger.debug('auth.ok', { user: shortUserId(verified.userId), scopes: verified.scopes.length })
  return {
    userId: verified.userId,
    ...(verified.clientId ? { clientId: verified.clientId } : {}),
    scopes: verified.scopes,
  }
}
