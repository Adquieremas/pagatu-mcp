/**
 * Herramientas de cobros: solo lectura y sin el dato de pago.
 *
 * Un método de cobro contiene el número de cuenta, el CCI, el IBAN o el alias
 * de billetera. Esta herramienta responde «qué métodos tengo configurados»
 * —tipo, titular, alias, país— y NO devuelve `data`, que es lo que haría falta
 * para cobrar. Si alguien necesita el número, lo ve en Pagatu, no a través de
 * un modelo.
 *
 * Tampoco hay nada aquí que mueva dinero: el MCP no crea cobros, no marca
 * pagos y no registra transacciones.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { defineTool } from './shared'
import type { ToolContext } from './shared'
import { asRows, paymentMethodSummary } from './shape'

export function registerPaymentTools(server: McpServer, context: ToolContext): void {
  defineTool(
    server,
    context,
    {
      name: 'pagatu_list_payment_methods',
      title: 'Listar métodos de cobro',
      description:
        'Lista los métodos de cobro configurados en tu cuenta de Pagatu (tipo, titular, alias, país). ' +
        'Por seguridad no devuelve números de cuenta, CCI, IBAN ni alias de billetera.',
      permission: 'read',
    },
    async (_args, ctx) => {
      const rows = asRows(await ctx.convex.query('listMyPaymentMethods'))
      return {
        count: rows.length,
        note: 'Los datos de cobro (cuenta, CCI, IBAN, alias) no se exponen por el MCP.',
        paymentMethods: rows.map(paymentMethodSummary),
      }
    },
  )
}
