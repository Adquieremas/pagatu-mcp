/**
 * Fechas en la frontera del MCP.
 *
 * Convex guarda epoch ms; un modelo escribe «2026-03-01» o
 * «2026-03-01T15:00:00Z». La conversión vive aquí y en un solo sitio para que
 * ninguna herramienta acepte una fecha que luego se traduzca en un rango
 * absurdo (NaN se convertiría en leer toda la agenda).
 */

import { ToolError } from '../errors'

export function parseInstant(value: string, field: string): number {
  const trimmed = value.trim()
  // Una fecha suelta se interpreta como el inicio de ese día en UTC: así
  // `from=2026-03-01` incluye el día entero y no depende de la zona del Worker.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed
  const parsed = Date.parse(normalized)
  if (Number.isNaN(parsed)) {
    throw new ToolError('invalid_date', `El campo ${field} no es una fecha ISO 8601 válida: «${value}».`)
  }
  return parsed
}

export function endOfDayIfDateOnly(value: string, field: string): number {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return parseInstant(`${trimmed}T23:59:59.999Z`, field)
  return parseInstant(trimmed, field)
}

export const DAY_MS = 86_400_000
