/**
 * Herramientas de clientes.
 *
 * `listClients` de Convex no acepta filtros (devuelve hasta 300 fichas del
 * perfil, enriquecidas con etiquetas y listas). El filtro por texto y el tope
 * se aplican AQUÍ, sobre lo que ya devolvió Convex: es un recorte de la
 * respuesta, no un endpoint nuevo. Se dice en la descripción de la herramienta
 * para que el modelo sepa que `search` no es una búsqueda del servidor.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { defineTool } from './shared'
import type { ToolContext } from './shared'
import { asRow, asRows, clientDetail, clientSummary } from './shape'
import { ToolError } from '../errors'

const CLIENT_TYPES = ['person', 'company'] as const

function matchesTerm(row: Record<string, unknown>, term: string): boolean {
  const haystack = ['name', 'businessName', 'razonSocial', 'email', 'phone', 'whatsapp', 'documentNumber', 'city']
    .map((key) => (typeof row[key] === 'string' ? (row[key] as string) : ''))
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

export function registerClientTools(server: McpServer, context: ToolContext): void {
  defineTool(
    server,
    context,
    {
      name: 'pagatu_list_clients',
      title: 'Listar clientes',
      description:
        'Lista los clientes de tu cuenta de Pagatu (hasta 300, los más recientes primero). ' +
        '`search` y `limit` filtran el resultado ya devuelto por Pagatu, no hacen una búsqueda en el servidor.',
      permission: 'read',
      inputSchema: {
        search: z.string().trim().min(1).max(120).optional().describe('Texto a buscar en nombre, razón social, email, teléfono o documento.'),
        limit: z.number().int().min(1).max(300).optional().describe('Máximo de clientes a devolver (por defecto 50).'),
      },
    },
    async (args, ctx) => {
      const rows = asRows(await ctx.convex.query('listClients'))
      const term = typeof args.search === 'string' ? args.search.trim().toLowerCase() : null
      const filtered = term ? rows.filter((row) => matchesTerm(row, term)) : rows
      const limit = typeof args.limit === 'number' ? args.limit : 50
      return {
        total: filtered.length,
        returned: Math.min(filtered.length, limit),
        truncated: filtered.length > limit,
        clients: filtered.slice(0, limit).map(clientSummary),
      }
    },
  )

  defineTool(
    server,
    context,
    {
      name: 'pagatu_get_client',
      title: 'Ver un cliente',
      description: 'Devuelve la ficha completa de un cliente de tu cuenta de Pagatu por su id.',
      permission: 'read',
      inputSchema: {
        clientId: z.string().trim().min(1).max(64).describe('Id del cliente en Pagatu (campo `id` del listado).'),
      },
    },
    async (args, ctx) => {
      const row = asRow(await ctx.convex.query('getClientById', { clientId: args.clientId as string }))
      // Convex devuelve `null` igual si no existe, si el id es inválido o si
      // es de otra cuenta. Aquí se repite esa indistinción a propósito.
      if (!row) throw new ToolError('not_found', 'No existe ese cliente en tu cuenta de Pagatu.')
      return { client: clientDetail(row) }
    },
  )

  defineTool(
    server,
    context,
    {
      name: 'pagatu_create_client',
      title: 'Crear cliente',
      description:
        'Crea un cliente en tu cuenta de Pagatu. Pagatu rechaza duplicados por documento, email o teléfono; ' +
        'usa `allowDuplicate` solo si de verdad quieres otra ficha con el mismo dato.',
      permission: 'write',
      idempotent: false,
      inputSchema: {
        name: z.string().trim().min(1).max(180).describe('Nombre o razón social del cliente. Obligatorio.'),
        clientType: z.enum(CLIENT_TYPES).optional().describe('`person` o `company`.'),
        email: z.string().trim().email().max(254).optional(),
        phone: z.string().trim().min(3).max(40).optional(),
        whatsapp: z.string().trim().min(3).max(40).optional(),
        documentType: z.string().trim().min(1).max(24).optional().describe('Tipo de documento (DNI, RUC, NIT, CUIT…).'),
        documentNumber: z.string().trim().min(1).max(32).optional(),
        businessName: z.string().trim().min(1).max(180).optional(),
        countryCode: z.string().trim().length(2).optional().describe('ISO 3166-1 alfa-2, p. ej. PE.'),
        city: z.string().trim().min(1).max(120).optional(),
        address: z.string().trim().min(1).max(300).optional(),
        website: z.string().trim().url().max(2048).optional(),
        preferredCurrency: z.string().trim().min(3).max(8).optional().describe('Código ISO, p. ej. PEN o USD.'),
        paymentTerms: z.string().trim().min(1).max(160).optional(),
        notes: z.string().trim().min(1).max(4000).optional().describe('Notas internas; no salen en los documentos.'),
        tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
        allowDuplicate: z.boolean().optional().describe('`true` para crear la ficha aunque Pagatu detecte un duplicado.'),
      },
    },
    async (args, ctx) => {
      const clientId = await ctx.convex.mutation<string>('createClient', args)
      return {
        created: true,
        clientId,
        // La app no tiene ficha por URL: la lista de clientes es el enlace
        // que SÍ existe. No se inventan rutas.
        url: `${ctx.config.appUrl}/clientes`,
      }
    },
  )
}
