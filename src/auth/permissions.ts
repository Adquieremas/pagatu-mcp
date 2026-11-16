/**
 * Permisos por operación.
 *
 * Tres capas, de fuera adentro:
 *
 * 1. `PAGATU_MCP_WRITE_ENABLED=false` → las herramientas de escritura NI SE
 *    REGISTRAN. Un servidor en modo lectura no las anuncia, así que el modelo
 *    no puede ni intentarlo.
 * 2. Scopes del access token: si el operador declara un scope obligatorio
 *    (`requiredScopes`), un token que no lo trae no ejecuta la herramienta.
 * 3. Convex: cada query/mutation resuelve el perfil del JWT y compara
 *    `profileId`. Esta es la capa que de verdad impide ver datos de otro, y no
 *    se duplica aquí a propósito — duplicarla sería tener dos reglas que
 *    pueden divergir.
 */

import { ForbiddenError } from '../errors'

export type ToolPermission = 'read' | 'write'

export interface ToolPolicy {
  name: string
  permission: ToolPermission
  /** Scopes OAuth que el token debe traer. Vacío = ninguno obligatorio. */
  requiredScopes?: string[]
}

export interface PolicyContext {
  scopes: string[]
  writeEnabled: boolean
}

/** Scopes que faltan en el token para una política dada. */
export function missingScopes(policy: ToolPolicy, scopes: string[]): string[] {
  const required = policy.requiredScopes ?? []
  return required.filter((scope) => !scopes.includes(scope))
}

export function assertToolAllowed(policy: ToolPolicy, context: PolicyContext): void {
  if (policy.permission === 'write' && !context.writeEnabled) {
    throw new ForbiddenError(
      `La herramienta ${policy.name} escribe en Pagatu y este servidor está en modo solo lectura.`,
      'write_disabled',
    )
  }
  const missing = missingScopes(policy, context.scopes)
  if (missing.length > 0) {
    throw new ForbiddenError(
      `Tu autorización no incluye los permisos necesarios (${missing.join(', ')}) para ${policy.name}.`,
      'insufficient_scope',
    )
  }
}
