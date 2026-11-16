/**
 * Identidad: de quién son los datos a los que el modelo está accediendo.
 *
 * Es la primera herramienta que conviene llamar al conectar: confirma que la
 * autorización OAuth apunta a la cuenta correcta de Pagatu antes de que el
 * modelo empiece a leer clientes o a crear documentos.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { defineTool } from './shared'
import type { ToolContext } from './shared'
import { asRow, profileSummary } from './shape'
import { ToolError } from '../errors'

export function registerProfileTools(server: McpServer, context: ToolContext): void {
  defineTool(
    server,
    context,
    {
      name: 'pagatu_whoami',
      title: 'Cuenta conectada',
      description: 'Devuelve la cuenta de Pagatu con la que está autorizado este servidor MCP y su plan.',
      permission: 'read',
    },
    async (_args, ctx) => {
      const row = asRow(await ctx.convex.query('getCurrentProfile'))
      if (!row) {
        throw new ToolError(
          'profile_not_found',
          `La cuenta autorizada todavía no tiene perfil en Pagatu. Entra una vez en ${ctx.config.appUrl} para crearlo.`,
        )
      }
      return {
        profile: profileSummary(row),
        writeEnabled: ctx.config.writeEnabled,
      }
    },
  )
}
