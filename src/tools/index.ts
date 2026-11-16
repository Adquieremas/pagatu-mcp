/**
 * Registro de herramientas.
 *
 * El orden importa poco; lo que importa es que sea UN sitio. Si
 * `PAGATU_MCP_WRITE_ENABLED` está en `false`, las de escritura no se registran
 * y por tanto no aparecen en `tools/list`: el cliente MCP ve un servidor de
 * solo lectura, no un servidor que rechaza la mitad de lo que anuncia.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './shared'
import { registerClientTools } from './clients'
import { registerDocumentTools } from './documents'
import { registerAgendaTools } from './agenda'
import { registerPaymentTools } from './payments'
import { registerInvoiceTools } from './invoices'
import { registerProfileTools } from './profile'

export const READ_ONLY_TOOLS = [
  'pagatu_whoami',
  'pagatu_list_clients',
  'pagatu_get_client',
  'pagatu_list_documents',
  'pagatu_get_document',
  'pagatu_list_appointments',
  'pagatu_agenda_overview',
  'pagatu_list_services',
  'pagatu_list_payment_methods',
  'pagatu_list_invoices',
  'pagatu_get_invoice',
  'pagatu_list_payments',
  'pagatu_list_document_templates',
] as const

export const WRITE_TOOLS = ['pagatu_create_client', 'pagatu_create_quote', 'pagatu_create_document'] as const

export function registerAllTools(server: McpServer, context: ToolContext): void {
  registerProfileTools(server, context)
  registerClientTools(server, context)
  registerDocumentTools(server, context)
  registerAgendaTools(server, context)
  registerInvoiceTools(server, context)
  registerPaymentTools(server, context)
}
