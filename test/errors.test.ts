import { describe, expect, it } from 'vitest'
import { PagatuSessionRequiredError, ToolError, toToolError } from '../src/errors'

const APP = 'https://app.pagatu.io'

describe('toToolError', () => {
  it('respeta el código estructurado de un ConvexError', () => {
    const convexError = Object.assign(new Error('PLAN_LIMIT_CLIENTS'), { data: { code: 'PLAN_LIMIT_CLIENTS' } })
    const result = toToolError(convexError, APP)
    expect(result.code).toBe('plan_limit_clients')
    expect(result.message).toContain('límite de clientes')
  })

  it('traduce un código desconocido sin filtrar el mensaje crudo', () => {
    const convexError = Object.assign(new Error('fallo interno con detalles'), { data: { code: 'RARO_123' } })
    const result = toToolError(convexError, APP)
    expect(result.code).toBe('raro_123')
    expect(result.message).not.toContain('detalles')
  })

  it('explica el duplicado de cliente con el campo que choca', () => {
    const result = toToolError(new Error('CLIENT_DUPLICATE:email:Ana Pérez'), APP)
    expect(result.code).toBe('client_duplicate')
    expect(result.message).toContain('email')
    expect(result.message).toContain('Ana Pérez')
    expect(result.details).toMatchObject({ field: 'email', existingName: 'Ana Pérez' })
  })

  it('convierte la falta de autenticación en instrucción de iniciar sesión', () => {
    const result = toToolError(new Error('NOT_AUTHENTICATED'), APP)
    expect(result).toBeInstanceOf(PagatuSessionRequiredError)
    expect(result.message).toContain(APP)
  })

  it('no distingue «no existe» de «es de otra cuenta»', () => {
    const result = toToolError(new Error('Quote not found or access denied'), APP)
    expect(result.code).toBe('not_found')
    expect(result.message).toBe('No existe ese registro en tu cuenta de Pagatu.')
  })

  it('un error inesperado no expone su mensaje interno', () => {
    const result = toToolError(new Error('TypeError: cannot read property secret of undefined'), APP)
    expect(result.code).toBe('convex_unavailable')
    expect(result.message).not.toMatch(/secret|TypeError/)
  })

  it('deja pasar un ToolError ya construido', () => {
    const original = new ToolError('invalid_date', 'fecha mal')
    expect(toToolError(original, APP)).toBe(original)
  })
})
