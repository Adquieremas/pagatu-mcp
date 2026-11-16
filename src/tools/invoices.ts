/**
 * Herramientas de facturas: solo lectura.
 *
 * Una factura de Pagatu NO es facturación electrónica —no se declara ante
 * ninguna autoridad—, pero sí consume numeración al emitirse y su estado lo
 * deriva el servidor del ledger de cobros. Por eso aquí se lee y no se
 * escribe: `createInvoiceDraft` e `issueInvoice` existen en Convex, y
 * exponerlas es una decisión que merece pedirse aparte.
 *
 * El estado que se devuelve es el EFECTIVO (`displayStatus`): vencida,
 * parcial y pagada no están guardadas en la tabla, se calculan con los cobros
 * y el reloj. Devolver el estado persistido a secas diría «emitida» de una
 * factura que lleva dos meses vencida.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { defineTool } from './shared'
import type { ToolContext } from './shared'
import { asRow, asRows, invoiceDetail, invoiceSummary } from './shape'
import { ToolError } from '../errors'

export function registerInvoiceTools(server: McpServer, context: ToolContext): void {
  defineTool(
    server,
    context,
    {
      name: 'pagatu_list_invoices',
      title: 'Listar facturas',
      description:
        'Lista las facturas de tu cuenta de Pagatu con su estado efectivo (borrador, emitida, parcial, pagada, vencida o anulada), ' +
        'lo cobrado y el saldo pendiente. Los importes van en la moneda de cada factura.',
      permission: 'read',
      inputSchema: {
        status: z
          .enum(['draft', 'issued', 'void'])
          .optional()
          .describe('Filtra por el estado GUARDADO. Parcial, pagada y vencida no se guardan: se derivan y salen en `status`.'),
        limit: z.number().int().min(1).max(200).optional().describe('Máximo de facturas (1-200, por defecto 50).'),
      },
    },
    async (args, ctx) => {
      const rows = asRows(
        await ctx.convex.query('listInvoices', {
          ...(args.status ? { status: args.status } : {}),
          ...(args.limit ? { limit: args.limit } : {}),
        }),
      )
      const invoices = rows.map(invoiceSummary)
      // Un total por moneda, no uno solo: sumar soles con dólares daría una
      // cifra que no significa nada.
      const pendingByCurrency: Record<string, number> = {}
      for (const invoice of invoices) {
        const currency = typeof invoice.currency === 'string' ? invoice.currency : '—'
        const balance = typeof invoice.balance === 'number' ? invoice.balance : 0
        if (balance > 0) pendingByCurrency[currency] = Math.round(((pendingByCurrency[currency] ?? 0) + balance) * 100) / 100
      }
      return { count: invoices.length, pendingByCurrency, invoices }
    },
  )

  defineTool(
    server,
    context,
    {
      name: 'pagatu_get_invoice',
      title: 'Ver una factura',
      description:
        'Devuelve una factura de tu cuenta de Pagatu con sus líneas, los datos fiscales de la contraparte, lo cobrado y el saldo. ' +
        'No devuelve el enlace público ni los snapshots internos.',
      permission: 'read',
      inputSchema: {
        invoiceId: z.string().trim().min(1).max(64).describe('Id de la factura (campo `id` del listado).'),
      },
    },
    async (args, ctx) => {
      const view = asRow(await ctx.convex.query('getInvoice', { invoiceId: args.invoiceId as string }))
      if (!view) throw new ToolError('not_found', 'No existe esa factura en tu cuenta de Pagatu.')
      return { invoice: invoiceDetail(view) }
    },
  )
}
