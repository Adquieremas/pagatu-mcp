import { describe, expect, it } from 'vitest'
import {
  clientSummary,
  documentDetail,
  documentSummary,
  invoiceDetail,
  invoiceSummary,
  paymentMethodSummary,
  paymentSummary,
  profileSummary,
} from '../src/tools/shape'

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

  it('muestra los días de validez aunque no haya fecha calculada', () => {
    expect(documentSummary({ _id: 'q', validityDays: 15 })).toMatchObject({ validityDays: 15 })
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

  it('una factura convierte los céntimos a unidades de la moneda', () => {
    const summary = invoiceSummary({
      invoice: {
        _id: 'inv_1',
        number: 'F001-00000012',
        status: 'issued',
        currency: 'PEN',
        subtotalCents: 30000,
        taxCents: 5400,
        totalCents: 35400,
      },
      displayStatus: 'partial',
      collectedCents: 10000,
      balanceCents: 25400,
    })
    // 35400 céntimos son 354,00 — no 35 400.
    expect(summary).toMatchObject({
      total: 354,
      subtotal: 300,
      tax: 54,
      collected: 100,
      balance: 254,
    })
  })

  it('el estado de una factura es el EFECTIVO, con el guardado aparte', () => {
    const summary = invoiceSummary({ invoice: { _id: 'i', status: 'issued' }, displayStatus: 'overdue' })
    expect(summary.status).toBe('overdue')
    expect(summary.storedStatus).toBe('issued')
  })

  it('una factura no expone el enlace público ni los snapshots crudos', () => {
    const detail = invoiceDetail({
      invoice: {
        _id: 'inv_1',
        totalCents: 1000,
        publicToken: 'tok_factura_secreto',
        issuerSnapshot: { iban: 'PE0012345678901234567890' },
        recipientSnapshot: { name: 'Cliente' },
        issueKey: 'clave-idempotencia',
      },
      counterparty: { name: 'Cliente SAC', taxId: '20512345678', taxIdLabel: 'RUC' },
      lines: [{ description: 'Servicio', quantity: 2, unitPriceCents: 50000, taxRateBps: 1800, lineTotalCents: 118000 }],
    })
    const serialized = JSON.stringify(detail)
    expect(serialized).not.toContain('tok_factura_secreto')
    expect(serialized).not.toContain('PE0012345678901234567890')
    expect(serialized).not.toContain('clave-idempotencia')
    expect(detail.client).toMatchObject({ name: 'Cliente SAC', taxId: '20512345678' })
  })

  it('una línea de factura traduce los puntos básicos a porcentaje', () => {
    const detail = invoiceDetail({
      invoice: { _id: 'i' },
      lines: [{ description: 'Hora', quantity: 1.5, unitPriceCents: 10000, taxRateBps: 1800, lineTotalCents: 17700 }],
    })
    expect((detail.lines as Array<Record<string, unknown>>)[0]).toMatchObject({
      unitPrice: 100,
      taxRate: 18,
      total: 177,
    })
  })

  it('un cobro usa el estado efectivo y no expone el código de transacción', () => {
    const summary = paymentSummary({
      _id: 'pay_1',
      concept: 'Anticipo',
      status: 'pending',
      effectiveStatus: 'overdue',
      currency: 'PEN',
      amount: 500,
      receivedAmount: 200,
      balanceAmount: 300,
      transactionCode: '000987654321',
      paymentMethodMasked: 'BCP ••••4321',
      installments: [{ amount: 200 }],
    })
    expect(summary).toMatchObject({ status: 'overdue', amount: 500, received: 200, balance: 300, installments: 1 })
    expect(JSON.stringify(summary)).not.toContain('000987654321')
  })
})
