/**
 * Acceso a Convex EN NOMBRE DEL USUARIO.
 *
 * El Worker no tiene deploy key ni admin key de Convex: cada llamada va
 * firmada con el JWT de Clerk del usuario (template `convex`), el mismo que
 * usa el navegador. Consecuencia buscada: si mañana alguien se equivoca y
 * expone una herramienta de más, sigue sin poder leer la cuenta de otro,
 * porque Convex resuelve el perfil desde ese token.
 *
 * El token se pide perezosamente: una herramienta que falle por permisos no
 * gasta una llamada a Clerk.
 */

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import type { Config } from '../env'
import type { Logger } from '../logging'
import { shortUserId } from '../logging'
import type { ClerkBackendClient } from '../auth/clerk'
import { toToolError } from '../errors'
import { CONVEX_FUNCTIONS } from './functions'
import type { ConvexMutationName, ConvexQueryName } from './functions'

export interface ConvexCaller {
  query<T = unknown>(name: ConvexQueryName, args?: Record<string, unknown>): Promise<T>
  mutation<T = unknown>(name: ConvexMutationName, args?: Record<string, unknown>): Promise<T>
}

/**
 * Crea el cliente de Convex para un usuario concreto.
 *
 * `tokenProvider` existe para los tests y para poder cambiar en el futuro de
 * dónde sale el JWT (otra plantilla, otro proveedor) sin tocar herramientas.
 */
export function createConvexCaller(options: {
  config: Config
  logger: Logger
  userId: string
  tokenProvider: () => Promise<string>
}): ConvexCaller {
  const { config, logger, userId, tokenProvider } = options
  let client: ConvexHttpClient | null = null
  let authedWith: string | null = null

  const ready = async (): Promise<ConvexHttpClient> => {
    const jwt = await tokenProvider()
    if (!client) client = new ConvexHttpClient(config.convexUrl)
    // El token de plantilla de Clerk dura ~60 s: se vuelve a poner cuando
    // cambia, no en cada llamada.
    if (authedWith !== jwt) {
      client.setAuth(jwt)
      authedWith = jwt
    }
    return client
  }

  const run = async <T>(name: ConvexQueryName | ConvexMutationName, args: Record<string, unknown>): Promise<T> => {
    const spec = CONVEX_FUNCTIONS[name]
    const convex = await ready()
    const started = Date.now()
    try {
      const reference =
        spec.kind === 'query'
          ? makeFunctionReference<'query'>(spec.path)
          : makeFunctionReference<'mutation'>(spec.path)
      const result =
        spec.kind === 'query'
          ? await convex.query(reference as ReturnType<typeof makeFunctionReference<'query'>>, args)
          : await convex.mutation(reference as ReturnType<typeof makeFunctionReference<'mutation'>>, args)
      logger.debug('convex.ok', { fn: spec.path, ms: Date.now() - started, user: shortUserId(userId) })
      return result as T
    } catch (error) {
      logger.warn('convex.failed', { fn: spec.path, ms: Date.now() - started })
      throw toToolError(error, config.appUrl)
    }
  }

  return {
    query: (name, args = {}) => run(name, args),
    mutation: (name, args = {}) => run(name, args),
  }
}

/** Proveedor de token real: Clerk firma el JWT del template de Convex. */
export function clerkTokenProvider(clerk: ClerkBackendClient, userId: string): () => Promise<string> {
  return async () => (await clerk.mintConvexToken(userId)).jwt
}
