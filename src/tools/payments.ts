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

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { defineTool } from './shared'
import type { ToolContext } from './shared'
import { asRows, paymentMethodSummary, paymentSummary } from './shape'

const PAYMENT_STATUS = ['pending', 'partial', 'paid', 'overdue', 'cancelled'] as const

function matchesPayment(row: Record<string, unknown>, term: string): boolean {
  return ['concept', 'clientName', 'reference', 'quoteNumber', 'quoteTitle', 'categoryName']
    .map((key) => (typeof row[key] === 'string' ? (row[key] as string) : ''))
    .join(' ')
    .toLowerCase()
    .includes(term)
}

export function registerPaymentTools(server: McpServer, context: ToolContext): void {
  defineTool(
    server,
    context,
    {
      name: 'pagatu_list_payments',
      title: 'Listar cobros',
      description:
        'Lista los cobros de tu cuenta de Pagatu (hasta 500, los más recientes primero) con su estado efectivo, ' +
        'lo recibido y el saldo. `search`, `status` y `limit` filtran el resultado ya devuelto por Pagatu, ' +
        'no hacen una consulta filtrada en el servidor.',
      permission: 'read',
      inputSchema: {
        search: z.string().trim().min(1).max(120).optional().describe('Texto en concepto, cliente, referencia, documento o categoría.'),
        status: z.enum(PAYMENT_STATUS).optional().describe('Estado efectivo: pending, partial, paid, overdue o cancelled.'),
        limit: z.number().int().min(1).max(200).optional().describe('Máximo de cobros a devolver (por defecto 50).'),
      },
    },
    async (args, ctx) => {
      const rows = asRows(await ctx.convex.query('listPayments'))
      const term = typeof args.search === 'string' ? args.search.trim().toLowerCase() : null
      const porTexto = term ? rows.filter((row) => matchesPayment(row, term)) : rows
      const filtered = args.status
        ? porTexto.filter((row) => row.effectiveStatus === args.status || row.status === args.status)
        : porTexto
      const limit = typeof args.limit === 'number' ? args.limit : 50

      // Pendiente por moneda: sumar soles con dólares daría una cifra falsa.
      const pendingByCurrency: Record<string, number> = {}
      for (const row of filtered) {
        const currency = typeof row.currency === 'string' ? row.currency : '—'
        const balance = typeof row.balanceAmount === 'number' ? row.balanceAmount : 0
        if (balance > 0) pendingByCurrency[currency] = Math.round(((pendingByCurrency[currency] ?? 0) + balance) * 100) / 100
      }

      return {
        total: filtered.length,
        returned: Math.min(filtered.length, limit),
        truncated: filtered.length > limit,
        pendingByCurrency,
        payments: filtered.slice(0, limit).map(paymentSummary),
      }
    },
  )

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
