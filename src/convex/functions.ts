/**
 * LAS ÚNICAS funciones de Convex que este servidor puede llamar.
 *
 * Es una lista blanca, no un índice de conveniencia: las herramientas reciben
 * una clave de este objeto, nunca una cadena libre, así que no hay forma de
 * invocar nada que no esté aquí ni de «inventar» un endpoint que no existe en
 * Pagatu. Cada entrada apunta a una función que YA existe en
 * `PAGATU/convex/*.ts` con esa misma firma; si alguien la renombra allí, lo
 * que falla es esta llamada, en un sitio, y no diez herramientas.
 *
 * Todas son funciones PÚBLICAS y autenticadas: resuelven el perfil a partir
 * del JWT (`getProfileOrNull` / `getOrCreateAuthProfile`) y comparan
 * `profileId` antes de devolver o escribir nada. Aquí no se llama a ninguna
 * `internal*`, que es exactamente lo que impide que el MCP lea con privilegios
 * que el usuario no tiene.
 */

export type ConvexFunctionKind = 'query' | 'mutation'

export interface ConvexFunctionSpec {
  /** Ruta Convex `archivo:export`. */
  readonly path: string
  readonly kind: ConvexFunctionKind
  /** Para qué se usa, en una línea. */
  readonly description: string
}

export const CONVEX_FUNCTIONS = {
  // ─── Perfil ─────────────────────────────────────────────────────────────
  getCurrentProfile: {
    path: 'profiles:getCurrentProfile',
    kind: 'query',
    description: 'Perfil del usuario autenticado (proyección pública).',
  },
  // ─── Clientes ───────────────────────────────────────────────────────────
  listClients: {
    path: 'clients:listClients',
    kind: 'query',
    description: 'Hasta 300 clientes del perfil, con etiquetas y lista.',
  },
  getClientById: {
    path: 'clients:getClientById',
    kind: 'query',
    description: 'Un cliente del perfil por id.',
  },
  createClient: {
    path: 'clients:createClient',
    kind: 'mutation',
    description: 'Crea un cliente en el perfil del usuario.',
  },
  // ─── Documentos (cotizaciones, propuestas, contratos…) ──────────────────
  listQuotesPage: {
    path: 'quotes:listQuotesPage',
    kind: 'query',
    description: 'Página de documentos con filtros de estado, tipo, categoría y búsqueda.',
  },
  getQuote: {
    path: 'quotes:getQuote',
    kind: 'query',
    description: 'Metadatos e ítems de un documento del perfil.',
  },
  createQuoteWithItems: {
    path: 'quotes:createQuoteWithItems',
    kind: 'mutation',
    description: 'Crea una cotización con sus ítems (borrador por defecto).',
  },
  // ─── Agenda ─────────────────────────────────────────────────────────────
  listAppointments: {
    path: 'agenda:listAppointments',
    kind: 'query',
    description: 'Citas del perfil, filtrables por rango y estado.',
  },
  getAgendaOverview: {
    path: 'agenda:getAgendaOverview',
    kind: 'query',
    description: 'Resumen de agenda: hoy, próximas, pendientes e ingreso asociado.',
  },
  listServices: {
    path: 'agenda:listServices',
    kind: 'query',
    description: 'Servicios reservables del perfil.',
  },
  // ─── Métodos de cobro ───────────────────────────────────────────────────
  listMyPaymentMethods: {
    path: 'paymentMethods:listMyPaymentMethods',
    kind: 'query',
    description: 'Métodos de cobro activos del perfil.',
  },
} as const satisfies Record<string, ConvexFunctionSpec>

export type ConvexFunctionName = keyof typeof CONVEX_FUNCTIONS

export type ConvexQueryName = {
  [K in ConvexFunctionName]: (typeof CONVEX_FUNCTIONS)[K]['kind'] extends 'query' ? K : never
}[ConvexFunctionName]

export type ConvexMutationName = {
  [K in ConvexFunctionName]: (typeof CONVEX_FUNCTIONS)[K]['kind'] extends 'mutation' ? K : never
}[ConvexFunctionName]
