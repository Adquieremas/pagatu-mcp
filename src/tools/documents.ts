/**
 * Herramientas de documentos: consulta y creación de cotizaciones.
 *
 * En Pagatu una «cotización» y un «contrato» son la misma tabla (`quotes`) con
 * `documentType` distinto, así que listar documentos y listar cotizaciones es
 * la misma función con un filtro. La paginación es la de Convex
 * (`listQuotesPage` devuelve un cursor): se expone tal cual en vez de pedir
 * todo y recortar, porque una cuenta con mil documentos no cabe en una
 * respuesta.
 *
 * Crear SIEMPRE crea un borrador: `createQuoteWithItems` sin `status` deja el
 * documento en `draft`, que es el estado que no consume correlativo y no sale
 * del escritorio de su dueño. Emitir, enviar, firmar o borrar no se exponen
 * aquí a propósito.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { defineTool } from './shared'
import type { ToolContext } from './shared'
import { asRow, asRows, documentDetail, documentSummary } from './shape'
import { ToolError } from '../errors'
import { DAY_MS, parseInstant } from './datetime'

/** Tipos de documento de Pagatu (`convex/documentNumbering.ts`). */
const DOCUMENT_TYPES = ['quote', 'proposal', 'contract', 'collaboration_agreement', 'letter', 'free_document'] as const

const itemSchema = z.object({
  name: z.string().trim().min(1).max(300).describe('Concepto de la línea.'),
  description: z.string().trim().min(1).max(2000).optional(),
  quantity: z.number().positive().max(1_000_000).describe('Cantidad (puede ser decimal).'),
  unitPrice: z.number().min(0).max(1_000_000_000).describe('Precio unitario sin impuestos.'),
})

export function registerDocumentTools(server: McpServer, context: ToolContext): void {
  defineTool(
    server,
    context,
    {
      name: 'pagatu_list_documents',
      title: 'Listar documentos',
      description:
        'Lista los documentos de tu cuenta de Pagatu (cotizaciones, propuestas, contratos…) con paginación. ' +
        'Devuelve `nextCursor` cuando queda más por leer: pásalo en `cursor` para la página siguiente.',
      permission: 'read',
      inputSchema: {
        status: z.string().trim().min(1).max(40).optional().describe('Estado exacto: draft, sent, accepted, rejected, signed, completed…'),
        documentType: z.enum(DOCUMENT_TYPES).optional().describe('Tipo de documento. Los antiguos sin tipo cuentan como `quote`.'),
        category: z.string().trim().min(1).max(60).optional(),
        search: z.string().trim().min(1).max(120).optional().describe('Búsqueda por título, número o cliente (la hace Pagatu).'),
        limit: z.number().int().min(1).max(50).optional().describe('Documentos por página (1-50, por defecto 20).'),
        cursor: z.string().min(1).max(4096).optional().describe('Cursor devuelto por una llamada anterior.'),
      },
    },
    async (args, ctx) => {
      const result = asRow(
        await ctx.convex.query('listQuotesPage', {
          ...(args.cursor ? { cursor: args.cursor } : {}),
          ...(args.limit ? { numItems: args.limit } : {}),
          ...(args.status ? { status: args.status } : {}),
          ...(args.documentType ? { type: args.documentType } : {}),
          ...(args.category ? { category: args.category } : {}),
          ...(args.search ? { search: args.search } : {}),
        }),
      )
      const page = asRows(result?.page)
      const isDone = result?.isDone === true
      const cursor = typeof result?.continueCursor === 'string' ? result.continueCursor : null
      return {
        count: page.length,
        isDone,
        nextCursor: isDone ? null : cursor,
        documents: page.map(documentSummary),
      }
    },
  )

  defineTool(
    server,
    context,
    {
      name: 'pagatu_get_document',
      title: 'Ver un documento',
      description:
        'Devuelve los datos y las líneas de un documento de tu cuenta de Pagatu. ' +
        'No devuelve el contenido del editor ni la imagen de las firmas.',
      permission: 'read',
      inputSchema: {
        documentId: z.string().trim().min(1).max(64).describe('Id del documento (campo `id` del listado).'),
      },
    },
    async (args, ctx) => {
      const row = asRow(await ctx.convex.query('getQuote', { quoteId: args.documentId as string }))
      if (!row) throw new ToolError('not_found', 'No existe ese documento en tu cuenta de Pagatu.')
      return {
        document: documentDetail(row),
        url: `${ctx.config.appUrl}/documentos/ver/${args.documentId as string}`,
      }
    },
  )

  defineTool(
    server,
    context,
    {
      name: 'pagatu_create_quote',
      title: 'Crear cotización (borrador)',
      description:
        'Crea una cotización en BORRADOR en tu cuenta de Pagatu, con sus líneas. ' +
        'No la emite, no la envía al cliente y no consume numeración: queda en Pagatu para que la revises y la envíes tú. ' +
        'Los totales los calcula Pagatu a partir de las líneas, el descuento y el impuesto.',
      permission: 'write',
      idempotent: false,
      inputSchema: {
        title: z.string().trim().min(1).max(300).describe('Título de la cotización. Obligatorio.'),
        items: z.array(itemSchema).min(1).max(100).describe('Al menos una línea.'),
        clientId: z.string().trim().min(1).max(64).optional().describe('Id de un cliente tuyo; Pagatu congela sus datos en el documento.'),
        clientName: z.string().trim().min(1).max(180).optional().describe('Nombre del cliente cuando todavía no tiene ficha.'),
        currency: z.string().trim().min(3).max(8).optional().describe('ISO, p. ej. PEN o USD. Por defecto, la de tu perfil.'),
        discount: z.number().min(0).max(1_000_000_000).optional().describe('Descuento en importe, no en porcentaje.'),
        tax: z.number().min(0).max(1_000_000_000).optional().describe('Impuesto en importe, no en porcentaje.'),
        validityDays: z.number().int().min(1).max(3650).optional().describe('Días de validez desde hoy.'),
        validUntil: z.string().trim().min(8).max(40).optional().describe('Fecha de validez en ISO 8601 (alternativa a `validityDays`).'),
        description: z.string().trim().min(1).max(4000).optional(),
        scope: z.string().trim().min(1).max(4000).optional().describe('Alcance del trabajo.'),
        paymentTerms: z.string().trim().min(1).max(1000).optional(),
        conditions: z.string().trim().min(1).max(4000).optional(),
        observations: z.string().trim().min(1).max(4000).optional(),
        notes: z.string().trim().min(1).max(4000).optional(),
        estimatedTime: z.string().trim().min(1).max(200).optional(),
        category: z.string().trim().min(1).max(60).optional(),
      },
    },
    async (args, ctx) => {
      const { validUntil, ...rest } = args
      const payload: Record<string, unknown> = { ...rest }
      if (typeof validUntil === 'string') payload.validUntil = parseInstant(validUntil, 'validUntil')

      // `validityDays` SIN fecha: aquí se calcula la fecha.
      //
      // Convex solo deriva `validUntil` en su rama por defecto —cuando no
      // recibe ni `validUntil` ni `validityDays` y la toma de las preferencias
      // del perfil (`quotes.ts`: `now + preference.validityDays * 86400000`)—.
      // Si llegan los días sueltos, los guarda tal cual y el documento se
      // queda SIN fecha de validez. Comprobado creando una cotización de
      // prueba con `validityDays: 15`: ni `validUntil` ni vencimiento visible.
      //
      // Se completa el argumento con la MISMA fórmula que usa Convex, no con
      // una regla nueva: es rellenar lo que el editor de la app también manda,
      // para que «días de validez desde hoy» signifique lo que promete.
      if (payload.validUntil === undefined && typeof payload.validityDays === 'number') {
        payload.validUntil = Date.now() + payload.validityDays * DAY_MS
      }

      // `status` NO se envía: Convex deja el documento en `draft`, y es la
      // única forma de garantizar que esta herramienta no emita nada.
      const quoteId = await ctx.convex.mutation<string>('createQuoteWithItems', payload)
      return {
        created: true,
        documentId: quoteId,
        status: 'draft',
        url: `${ctx.config.appUrl}/documentos/ver/${quoteId}`,
      }
    },
  )
}
