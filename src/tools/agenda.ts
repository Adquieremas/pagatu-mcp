/**
 * Herramientas de agenda: solo lectura.
 *
 * Crear, mover o cancelar una cita afecta a terceros —el cliente recibe
 * recordatorios y, si hay Google Calendar conectado, se sincroniza fuera de
 * Pagatu—, así que el MCP lee la agenda y no la escribe.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { defineTool } from './shared'
import type { ToolContext } from './shared'
import { appointmentSummary, asRow, asRows, serviceSummary } from './shape'
import { DAY_MS, endOfDayIfDateOnly, parseInstant } from './datetime'
import { ToolError } from '../errors'

const APPOINTMENT_STATUS = ['pending', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show'] as const

export function registerAgendaTools(server: McpServer, context: ToolContext): void {
  defineTool(
    server,
    context,
    {
      name: 'pagatu_list_appointments',
      title: 'Listar citas',
      description:
        'Lista las citas de tu agenda de Pagatu. Sin rango, devuelve las próximas 4 semanas desde hoy. ' +
        'Pagatu devuelve como máximo 100 citas por llamada.',
      permission: 'read',
      inputSchema: {
        from: z.string().trim().min(8).max(40).optional().describe('Inicio del rango en ISO 8601 (`2026-03-01` o con hora).'),
        to: z.string().trim().min(8).max(40).optional().describe('Fin del rango en ISO 8601. Una fecha suelta incluye el día completo.'),
        status: z.enum(APPOINTMENT_STATUS).optional().describe('Filtra por estado. Nota: Pagatu ignora el rango cuando filtras por estado.'),
      },
    },
    async (args, ctx) => {
      const hasRange = typeof args.from === 'string' || typeof args.to === 'string'
      const startAt = typeof args.from === 'string' ? parseInstant(args.from, 'from') : Date.now()
      const endAt = typeof args.to === 'string' ? endOfDayIfDateOnly(args.to, 'to') : startAt + 28 * DAY_MS
      if (endAt < startAt) {
        throw new ToolError('invalid_range', 'El fin del rango (`to`) es anterior al inicio (`from`).')
      }

      const rows = asRows(
        await ctx.convex.query('listAppointments', {
          // Convex sólo aplica el rango si llegan AMBOS extremos; se mandan
          // siempre juntos para que `from` sin `to` no acabe leyendo todo.
          startAt,
          endAt,
          ...(args.status ? { status: args.status } : {}),
        }),
      )

      return {
        range: { from: new Date(startAt).toISOString(), to: new Date(endAt).toISOString(), applied: !args.status },
        rangeExplicit: hasRange,
        count: rows.length,
        appointments: rows.map(appointmentSummary),
      }
    },
  )

  defineTool(
    server,
    context,
    {
      name: 'pagatu_agenda_overview',
      title: 'Resumen de agenda',
      description:
        'Resumen de tu agenda de Pagatu: citas de hoy, próximas, pendientes de confirmar e ingreso asociado a las próximas citas.',
      permission: 'read',
    },
    async (_args, ctx) => {
      const row = asRow(await ctx.convex.query('getAgendaOverview'))
      if (!row) return { todayCount: 0, upcomingCount: 0, pendingCount: 0, associatedIncome: 0, appointments: [] }
      return {
        todayCount: row.todayCount ?? 0,
        upcomingCount: row.upcomingCount ?? 0,
        pendingCount: row.pendingCount ?? 0,
        associatedIncome: row.associatedIncome ?? 0,
        appointments: asRows(row.appointments).map(appointmentSummary),
      }
    },
  )

  defineTool(
    server,
    context,
    {
      name: 'pagatu_list_services',
      title: 'Listar servicios de agenda',
      description: 'Lista los servicios reservables configurados en tu agenda de Pagatu, con su duración y precio.',
      permission: 'read',
    },
    async (_args, ctx) => {
      const rows = asRows(await ctx.convex.query('listServices'))
      return { count: rows.length, services: rows.map(serviceSummary) }
    },
  )
}
