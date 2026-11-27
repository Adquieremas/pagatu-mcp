/**
 * Pagatu MCP — punto de entrada del Worker.
 *
 * Rutas:
 *   POST/GET/DELETE /mcp                                  → protocolo MCP (Streamable HTTP)
 *   GET  /.well-known/oauth-protected-resource[/mcp]       → metadatos RFC 9728
 *   GET  /.well-known/oauth-authorization-server           → redirección a Clerk
 *   GET  /health                                           → sonda sin autenticación
 *
 * Lo que este Worker NO hace, y es deliberado: no guarda datos, no tiene base
 * de datos propia, no cachea respuestas de Convex y no habla con Convex con
 * credenciales de administrador. Es un traductor entre MCP y las funciones que
 * Pagatu ya tiene, con la identidad del usuario por delante.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Env } from './env'
import { ConfigError, resolveConfig } from './env'
import { loggerFromConfig, createLogger, shortUserId } from './logging'
import { HttpError } from './errors'
import { jsonResponse, jsonRpcError, preflight, withCors } from './http'
import { authenticateRequest, extractBearer } from './auth/session'
import { ClerkBackendClient } from './auth/clerk'
import { MCP_PATH, protectedResourceMetadata } from './auth/metadata'
import { clerkTokenProvider, createConvexCaller } from './convex/client'
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server'

/** Códigos JSON-RPC: lo que un cliente MCP sabe interpretar. */
const JSON_RPC_INVALID_REQUEST = -32600
const JSON_RPC_INTERNAL_ERROR = -32603

function isWellKnownResource(pathname: string): boolean {
  return (
    pathname === '/.well-known/oauth-protected-resource' ||
    pathname === `/.well-known/oauth-protected-resource${MCP_PATH}`
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return preflight()

    // La sonda no depende de la configuración: tiene que responder incluso en
    // un despliegue a medio configurar, que es cuando más falta hace.
    if (url.pathname === '/health') {
      return jsonResponse({ ok: true, service: SERVER_NAME, version: SERVER_VERSION })
    }

    // Verificación de dominio de OpenAI. Antes de resolver la configuración,
    // igual que /health: es una comprobación de propiedad del dominio, no
    // necesita Clerk ni Convex. Devuelve el token EXACTO, sin envolver en
    // JSON, porque eso es lo que compara su panel.
    if (url.pathname === '/.well-known/openai-apps-challenge') {
      const challenge = env.OPENAI_APPS_CHALLENGE?.trim()
      if (!challenge) {
        return jsonResponse(
          { error: 'not_configured', message: 'Falta OPENAI_APPS_CHALLENGE en el Worker.' },
          404,
        )
      }
      return withCors(
        new Response(challenge, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
      )
    }

    let config
    try {
      config = resolveConfig(env)
    } catch (error) {
      if (error instanceof ConfigError) {
        createLogger('error').error('config.incomplete', {
          missing: error.missing,
          invalid: error.invalid,
        })
        return jsonResponse(
          {
            error: 'server_misconfigured',
            message: error.message,
            missing: error.missing,
            invalid: error.invalid,
          },
          503,
        )
      }
      throw error
    }

    const logger = loggerFromConfig(config, { service: SERVER_NAME })

    if (isWellKnownResource(url.pathname)) {
      return jsonResponse(protectedResourceMetadata(config))
    }

    // Algunos clientes buscan los metadatos del Authorization Server en el
    // propio servidor MCP. Aquí no vive: se les manda a Clerk, que es quien
    // emite los tokens.
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return withCors(
        Response.redirect(`${config.clerkIssuer}/.well-known/oauth-authorization-server`, 302),
      )
    }

    if (url.pathname !== MCP_PATH) {
      return jsonResponse({ error: 'not_found', message: `Ruta desconocida: ${url.pathname}` }, 404)
    }

    try {
      const clerk = new ClerkBackendClient(config, logger)
      const auth = await authenticateRequest(request, config, logger, clerk)

      const convex = createConvexCaller({
        config,
        logger,
        userId: auth.userId,
        tokenProvider: clerkTokenProvider(clerk, auth.userId),
      })

      const server = createMcpServer({ config, logger, auth, convex })
      // Sin estado: ni `Mcp-Session-Id` ni SSE. Un Worker no mantiene la
      // conexión viva entre invocaciones, así que fingir una sesión sería
      // prometer algo que no se puede cumplir.
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      await server.connect(transport)

      const token = extractBearer(request)
      const response = await transport.handleRequest(request, {
        authInfo: {
          token: token ?? '',
          clientId: auth.clientId ?? 'unknown',
          scopes: auth.scopes,
          extra: { userId: auth.userId },
        },
      })

      logger.debug('mcp.handled', { status: response.status, user: shortUserId(auth.userId) })
      return withCors(response)
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonRpcError(error.status, JSON_RPC_INVALID_REQUEST, error.message, error.headers)
      }
      // Un error sin detalle («Internal Server Error» a secas) no ayuda a
      // nadie: ni al usuario, que no sabe si reintentar, ni a la revisión del
      // directorio de Claude, que lo rechaza expresamente. Se nombra la etapa
      // y el tipo de fallo —nunca el mensaje interno, que puede llevar datos.
      const detalle = error instanceof Error ? error.name : 'UnknownError'
      logger.error('mcp.unhandled', { message: error instanceof Error ? error.message : 'unknown' })
      return jsonRpcError(
        500,
        JSON_RPC_INTERNAL_ERROR,
        `El servidor MCP de Pagatu falló al procesar la petición (${detalle}) después de autenticarte. ` +
          'No se escribió nada en tu cuenta. Vuelve a intentarlo; si persiste, revisa el estado en ' +
          'https://mcp.pagatu.io/health',
      )
    }
  },
}
