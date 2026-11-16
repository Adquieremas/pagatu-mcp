import { describe, expect, it } from 'vitest'
import { CONVEX_FUNCTIONS } from '../src/convex/functions'

/**
 * Este test es el contrato con el backend de Pagatu: la lista de funciones que
 * el MCP puede llamar, congelada. Si alguien añade una entrada, tiene que
 * tocar también este test — y al tocarlo, mirar si la función existe de verdad
 * en `convex/` y si es pública y autenticada.
 */
const ESPERADAS = [
  'profiles:getCurrentProfile',
  'clients:listClients',
  'clients:getClientById',
  'clients:createClient',
  'quotes:listQuotesPage',
  'quotes:getQuote',
  'quotes:createQuoteWithItems',
  'agenda:listAppointments',
  'agenda:getAgendaOverview',
  'agenda:listServices',
  'paymentMethods:listMyPaymentMethods',
]

describe('lista blanca de funciones Convex', () => {
  it('es exactamente la acordada', () => {
    expect(Object.values(CONVEX_FUNCTIONS).map((spec) => spec.path).sort()).toEqual([...ESPERADAS].sort())
  })

  it('no contiene ninguna función interna', () => {
    for (const spec of Object.values(CONVEX_FUNCTIONS)) {
      expect(spec.path).not.toMatch(/internal/i)
      expect(spec.path).toMatch(/^[a-zA-Z]+:[a-zA-Z]+$/)
    }
  })

  it('solo las dos escrituras previstas son mutations', () => {
    const mutations = Object.values(CONVEX_FUNCTIONS)
      .filter((spec) => spec.kind === 'mutation')
      .map((spec) => spec.path)
    expect(mutations.sort()).toEqual(['clients:createClient', 'quotes:createQuoteWithItems'])
  })
})
