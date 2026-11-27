/**
 * Andamio común de las herramientas MCP.
 *
 * Toda herramienta pasa por `defineTool`, que garantiza cuatro cosas iguales
 * para todas: se comprueba el permiso ANTES de tocar Convex, el error se
 * traduce a un código estable (nunca un stack), la respuesta es JSON legible
 * para el modelo, y la escritura queda anotada como tal en las annotations MCP
 * para que el cliente pueda pedir confirmación.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { Config } from '../env'
import type { Logger } from '../logging'
import { shortUserId } from '../logging'
import type { AuthContext } from '../auth/session'
import type { ConvexCaller } from '../convex/client'
import { assertToolAllowed } from '../auth/permissions'
import type { ToolPermission } from '../auth/permissions'
import { ForbiddenError, ToolError, toToolError } from '../errors'

export interface ToolContext {
  config: Config
  logger: Logger
  auth: AuthContext
  convex: ConvexCaller
}

export interface ToolDefinition<Shape extends ZodRawShapeCompat> {
  name: string
  title: string
  description: string
  permission: ToolPermission
  requiredScopes?: string[]
  inputSchema?: Shape
  /** Pista para el cliente: `true` = no modifica nada. */
  readOnly?: boolean
  /** Pista para el cliente: `true` = repetir la llamada crea otra cosa. */
  idempotent?: boolean
}

export function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

export function errorResult(error: ToolError): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: { code: error.code, message: error.message, ...(error.details ?? {}) } }, null, 2),
      },
    ],
  }
}

/**
 * Registra una herramienta con permiso, logging y traducción de errores.
 *
 * El handler devuelve DATOS; convertirlos en `CallToolResult` y decidir qué
 * pasa cuando algo falla es responsabilidad de aquí, no de cada herramienta.
 */
export function defineTool<Shape extends ZodRawShapeCompat>(
  server: McpServer,
  context: ToolContext,
  definition: ToolDefinition<Shape>,
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>,
): void {
  const { config, logger } = context

  const policy = {
    name: definition.name,
    permission: definition.permission,
    ...(definition.requiredScopes ? { requiredScopes: definition.requiredScopes } : {}),
  }

  // Servidor en modo solo lectura: la herramienta de escritura NI SE ANUNCIA.
  // Registrarla para después rechazarla le haría creer al modelo que puede
  // escribir, y gastaría un turno en descubrir que no.
  if (definition.permission === 'write' && !config.writeEnabled) {
    logger.debug('tool.skipped_write_disabled', { tool: definition.name })
    return
  }

  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      ...(definition.inputSchema ? { inputSchema: definition.inputSchema } : {}),
      // ANOTACIONES. El directorio de conectores de Claude exige que cada
      // herramienta lleve `title` y, según lo que haga, `readOnlyHint: true`
      // (solo lee) o `destructiveHint: true` (modifica o borra datos); una
      // herramienta de escritura con los dos en `false` no pasa la revisión.
      //
      // Matiz que conviene no perder: en la especificación MCP
      // «destructive» significa «puede sobrescribir o destruir», y crear un
      // borrador no destruye nada. Aquí se marca igualmente porque el
      // criterio del directorio es «modifica datos» y porque el efecto
      // práctico es el que queremos: el cliente pide confirmación antes de
      // escribir en la cuenta de alguien.
      annotations: {
        title: definition.title,
        readOnlyHint: definition.permission === 'read',
        destructiveHint: definition.permission === 'write',
        idempotentHint: definition.idempotent ?? definition.permission === 'read',
        openWorldHint: true,
      },
    },
    // El SDK ya validó los argumentos contra el esquema zod antes de llegar
    // aquí: lo que entra en el handler está tipado y dentro de rango.
    (async (args: Record<string, unknown>) => {
      const started = Date.now()
      try {
        assertToolAllowed(policy, { scopes: context.auth.scopes, writeEnabled: config.writeEnabled })
        const data = await handler(args ?? {}, context)
        logger.info('tool.ok', {
          tool: definition.name,
          ms: Date.now() - started,
          user: shortUserId(context.auth.userId),
        })
        return jsonResult(data)
      } catch (error) {
        // Un 403 de política se devuelve como error de herramienta, no como
        // fallo HTTP: la conexión MCP sigue siendo válida, lo que no vale es
        // esta llamada.
        const toolError =
          error instanceof ForbiddenError
            ? new ToolError(error.code, error.message)
            : toToolError(error, config.appUrl)
        logger.warn('tool.failed', {
          tool: definition.name,
          code: toolError.code,
          ms: Date.now() - started,
          user: shortUserId(context.auth.userId),
        })
        return errorResult(toolError)
      }
      // El cast es necesario porque `defineTool` acepta cualquier shape y el
      // SDK infiere el tipo exacto de los argumentos por herramienta.
    }) as never,
  )
}
