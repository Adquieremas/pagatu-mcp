import { describe, expect, it } from 'vitest'
import { clientSummary, documentDetail, documentSummary, paymentMethodSummary, profileSummary } from '../src/tools/shape'

describe('proyecciones', () => {
  it('un cliente sale con sus datos de contacto y sin ruido interno', () => {
    const summary = clientSummary({
      _id: 'cl_1',
      name: 'Ana Pérez',
      email: 'ana@example.com',
      updatedAt: 1_700_000_000_000,
      profileId: 'pr_1',
      normalizedEmail: 'ana@example.com',
      createdByClerkId: 'user_123',
    })
    expect(summary).toMatchObject({ id: 'cl_1', name: 'Ana Pérez', email: 'ana@example.com' })
    expect(summary.updatedAt).toBe(new Date(1_700_000_000_000).toISOString())
    // Lo que identifica al dueño o la normalización interna no sale.
    expect(summary).not.toHaveProperty('profileId')
    expect(summary).not.toHaveProperty('normalizedEmail')
    expect(summary).not.toHaveProperty('createdByClerkId')
  })

  it('omite los campos vacíos en lugar de mandar nulls', () => {
    expect(Object.keys(clientSummary({ _id: 'cl_1', name: 'X', email: null, city: undefined }))).toEqual([
      'id',
      'name',
    ])
  })

  it('un documento no arrastra el contenido del editor ni el token público', () => {
    const detail = documentDetail({
      _id: 'q_1',
      title: 'Rediseño web',
      quoteNumber: 'COT-0001',
      status: 'draft',
      total: 1200,
      currency: 'PEN',
      richContent: { enorme: 'x'.repeat(5000) },
      richContentText: 'x'.repeat(5000),
      publicToken: 'tok_publico_secreto',
      brandSnapshot: { logoUrl: 'https://…' },
      items: [{ name: 'Diseño', quantity: 1, unitPrice: 1200, extraInterno: true }],
    })
    expect(detail).toMatchObject({ id: 'q_1', number: 'COT-0001', status: 'draft', total: 1200 })
    expect(JSON.stringify(detail)).not.toContain('tok_publico_secreto')
    expect(JSON.stringify(detail)).not.toContain('richContent')
    expect(JSON.stringify(detail)).not.toContain('extraInterno')
  })

  it('el número de una cotización viene de quoteNumber', () => {
    expect(documentSummary({ _id: 'q', quoteNumber: 'COT-9' }).number).toBe('COT-9')
  })

  it('un método de cobro NUNCA incluye el dato de pago', () => {
    const summary = paymentMethodSummary({
      _id: 'pm_1',
      type: 'bank_account',
      category: 'bank',
      holderName: 'Ana Pérez',
      aliasInterno: 'BCP soles',
      data: { accountNumber: '19100000000000', cci: '00219100000000000000' },
      qrImageKey: 'r2/qr/secreto.png',
    })
    expect(summary).toMatchObject({ id: 'pm_1', type: 'bank_account', holderName: 'Ana Pérez' })
    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain('19100000000000')
    expect(serialized).not.toContain('00219100000000000000')
    expect(serialized).not.toContain('r2/qr')
  })

  it('el plan sale de effectiveAccess, no del campo `plan` (que Convex no publica)', () => {
    const summary = profileSummary({
      _id: 'pr_1',
      name: 'Dilmer',
      email: 'hola@example.com',
      businessName: 'DilmerLoayza19',
      effectiveAccess: {
        billingPlan: 'free',
        accessPlan: 'business',
        displayName: 'Partner',
        internalPolicy: 'partner',
        aiMonthlyAllowance: 100,
      },
    })
    expect(summary).toMatchObject({ plan: 'business', planLabel: 'Partner', billingPlan: 'free' })
  })

  it('un perfil sin effectiveAccess no inventa un plan', () => {
    const summary = profileSummary({ _id: 'pr_1', name: 'Dilmer', plan: 'pro' })
    expect(summary).not.toHaveProperty('plan')
    expect(summary).not.toHaveProperty('planLabel')
  })
})
