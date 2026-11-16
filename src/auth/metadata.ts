/**
 * Descubrimiento OAuth del servidor MCP (RFC 9728 + MCP Authorization).
 *
 * Este Worker es SOLO Resource Server: no emite tokens, no guarda sesiones y
 * no tiene pantalla de consentimiento. El Authorization Server es la propia
 * instancia de Clerk de Pagatu, la misma que autentica la app — por eso
 * «reutilizar Clerk» no es una integración aparte: el MCP no añade un segundo
 * sistema de identidad.
 *
 * El cliente MCP (Claude, Codex) hace:
 *   1. POST /mcp sin token            → 401 + WWW-Authenticate con el enlace
 *      de abajo.
 *   2. GET  /.well-known/oauth-protected-resource/mcp → quién autoriza.
 *   3. GET  {clerk}/.well-known/oauth-authorization-server → endpoints y
 *      registro dinámico de cliente (DCR, que se activa en el dashboard de
 *      Clerk).
 *   4. Flujo authorization_code + PKCE contra Clerk y vuelta con un Bearer.
 */

import type { Config } from '../env'

/** Ruta canónica del recurso MCP. */
export const MCP_PATH = '/mcp'

export function resourceUrl(config: Config): string {
  return `${config.publicUrl}${MCP_PATH}`
}

/** `…/.well-known/oauth-protected-resource/mcp` (ruta del recurso al final). */
export function resourceMetadataUrl(config: Config): string {
  return `${config.publicUrl}/.well-known/oauth-protected-resource${MCP_PATH}`
}

export function protectedResourceMetadata(config: Config): Record<string, unknown> {
  return {
    resource: resourceUrl(config),
    authorization_servers: [config.clerkIssuer],
    bearer_methods_supported: ['header'],
    // Los scopes que pide un cliente MCP a Clerk. `profile` y `email`
    // identifican al usuario; Pagatu no necesita más para decidir permisos,
    // porque la autorización real la hace Convex con la identidad del dueño.
    scopes_supported: ['profile', 'email'],
    resource_name: 'Pagatu MCP',
    resource_documentation: 'https://github.com/Adquieremas/pagatu-mcp',
  }
}

/** Valor del header `WWW-Authenticate` de un 401. */
export function wwwAuthenticate(config: Config, description: string): string {
  const safe = description.replace(/"/g, "'")
  return [
    'Bearer realm="pagatu-mcp"',
    'error="invalid_token"',
    `error_description="${safe}"`,
    `resource_metadata="${resourceMetadataUrl(config)}"`,
  ].join(', ')
}
