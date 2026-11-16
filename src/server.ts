/**
 * Construcción del servidor MCP.
 *
 * Se crea UNO POR PETICIÓN, a propósito: el transporte Streamable HTTP corre
 * en modo sin estado (sin `Mcp-Session-Id`), así que no hay nada que compartir
 * entre dos llamadas y sí mucho que aislar — cada petición trae su propia
 * identidad y sus propios permisos. Un servidor por isolate obligaría a
 * recordar de quién era cada herramienta, que es justo el error que filtra
 * datos entre cuentas.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './tools/shared'
import { registerAllTools } from './tools'

export const SERVER_NAME = 'pagatu-mcp'
export const SERVER_VERSION = '0.1.0'

const INSTRUCTIONS = `Acceso a la cuenta de Pagatu.io del usuario autorizado (clientes, documentos, agenda y métodos de cobro).

Reglas de uso:
- Los datos son SIEMPRE de la cuenta autorizada. No hay forma de consultar la cuenta de otra persona.
- \`pagatu_create_quote\` crea un BORRADOR: no emite, no numera y no envía nada al cliente. Avísale al usuario de que debe revisarlo y enviarlo desde Pagatu.
- Los importes vienen en la moneda de cada documento (campo \`currency\`); no los conviertas sin decirlo.
- Los métodos de cobro se listan sin números de cuenta: si el usuario los necesita, dile que los vea en Pagatu.
- Si una herramienta responde \`pagatu_session_required\`, el usuario debe iniciar sesión en la app de Pagatu y repetir la operación.`

export function createMcpServer(context: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  )
  registerAllTools(server, context)
  return server
}
