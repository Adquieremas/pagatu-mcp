/**
 * Prueba de extremo a extremo del Worker: una petición HTTP real entra por
 * `fetch`, pasa por OAuth, por Clerk y por Convex (ambos simulados a nivel de
 * red) y sale como respuesta JSON-RPC. Es la que demuestra que las piezas
 * encajan; las demás prueban cada pieza por separado.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { __clearAuthCaches } from '../src/auth/clerk'
import { INITIALIZE, createFakeBackend, mcpRequest, stubFetch, testEnv } from './helpers'
import type { FakeBackend } from './helpers'

interface JsonRpcResponse {
  jsonrpc: string
  id?: number | string | null
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

async function call(payload: unknown, backend: FakeBackend, env = testEnv()): Promise<JsonRpcResponse> {
  stubFetch(backend)
  const response = await worker.fetch(mcpRequest(payload), env)
  expect(response.status).toBe(200)
  return (await response.json()) as JsonRpcResponse
}

function toolPayload(name: string, args: Record<string, unknown> = {}) {
  return { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }
}

function toolText(result: JsonRpcResponse): Record<string, unknown> {
  const content = result.result?.content as Array<{ type: string; text: string }> | undefined
  expect(content?.[0]?.type).toBe('text')
  return JSON.parse(content?.[0]?.text ?? '{}') as Record<string, unknown>
}

beforeEach(() => __clearAuthCaches())
afterEach(() => vi.unstubAllGlobals())

describe('rutas públicas', () => {
  it('/health responde sin configuración ni token', async () => {
    const response = await worker.fetch(new Request('https://mcp.pagatu.io/health'), {})
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, service: 'pagatu-mcp' })
  })

  it('un despliegue sin secretos responde 503 diciendo qué falta', async () => {
    const response = await worker.fetch(mcpRequest(INITIALIZE), {})
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: 'server_misconfigured',
      missing: ['CLERK_SECRET_KEY', 'CLERK_JWT_ISSUER_DOMAIN', 'CONVEX_URL', 'PAGATU_MCP_PUBLIC_URL'],
    })
  })

  it('publica los metadatos del recurso protegido', async () => {
    const response = await worker.fetch(
      new Request('https://mcp.pagatu.io/.well-known/oauth-protected-resource/mcp'),
      testEnv(),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      resource: 'https://mcp.pagatu.io/mcp',
      authorization_servers: ['https://clerk.pagatu.io'],
    })
  })

  it('la verificación de dominio de OpenAI devuelve el token en texto plano', async () => {
    const response = await worker.fetch(
      new Request('https://mcp.pagatu.io/.well-known/openai-apps-challenge'),
      testEnv({ OPENAI_APPS_CHALLENGE: 'token-de-openai-123' }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/plain')
    // El cuerpo es el token EXACTO: su panel lo compara carácter a carácter.
    expect(await response.text()).toBe('token-de-openai-123')
  })

  it('sin token configurado no inventa una verificación', async () => {
    const response = await worker.fetch(
      new Request('https://mcp.pagatu.io/.well-known/openai-apps-challenge'),
      testEnv(),
    )
    expect(response.status).toBe(404)
  })

  it('una ruta desconocida es 404, no un 500', async () => {
    const response = await worker.fetch(new Request('https://mcp.pagatu.io/otra-cosa'), testEnv())
    expect(response.status).toBe(404)
  })
})

describe('autorización', () => {
  it('sin Bearer devuelve 401 con el enlace de los metadatos', async () => {
    stubFetch(createFakeBackend())
    const response = await worker.fetch(
      new Request('https://mcp.pagatu.io/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify(INITIALIZE),
      }),
      testEnv(),
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata="https://mcp.pagatu.io/.well-known/oauth-protected-resource/mcp"',
    )
  })

  it('un token que Clerk rechaza devuelve 401', async () => {
    stubFetch(createFakeBackend({ verify: { status: 401, body: {} } }))
    const response = await worker.fetch(mcpRequest(INITIALIZE, 'tok_malo'), testEnv())
    expect(response.status).toBe(401)
  })

  it('un cliente OAuth fuera de la lista permitida devuelve 403', async () => {
    stubFetch(createFakeBackend())
    const response = await worker.fetch(
      mcpRequest(INITIALIZE),
      testEnv({ PAGATU_MCP_ALLOWED_CLIENT_IDS: 'solo_este_cliente' }),
    )
    expect(response.status).toBe(403)
  })

  it('una caída de Clerk no se confunde con un token inválido', async () => {
    stubFetch(createFakeBackend({ verify: { status: 503, body: {} } }))
    const response = await worker.fetch(mcpRequest(INITIALIZE), testEnv())
    expect(response.status).toBe(500)
    expect(response.headers.get('WWW-Authenticate')).toBeNull()
  })
})

describe('protocolo MCP', () => {
  it('initialize anuncia el servidor y sus instrucciones', async () => {
    const result = await call(INITIALIZE, createFakeBackend())
    expect(result.result).toMatchObject({ serverInfo: { name: 'pagatu-mcp' } })
    expect(String(result.result?.instructions)).toContain('BORRADOR')
  })

  it('tools/list expone lectura y escritura cuando la escritura está activa', async () => {
    const result = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, createFakeBackend())
    const names = (result.result?.tools as Array<{ name: string }>).map((tool) => tool.name)
    expect(names).toContain('pagatu_list_clients')
    expect(names).toContain('pagatu_create_quote')
    expect(names).toContain('pagatu_list_payment_methods')
    expect(names).toContain('pagatu_list_invoices')
    expect(names).toContain('pagatu_get_invoice')
    expect(names).toContain('pagatu_list_payments')
    expect(names).toContain('pagatu_create_document')
    expect(names).toContain('pagatu_list_document_templates')
  })

  it('cada herramienta anuncia title y la anotación que exige el directorio', async () => {
    const result = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, createFakeBackend())
    const tools = result.result?.tools as Array<{ name: string; annotations?: Record<string, unknown> }>
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      expect(tool.annotations?.title, tool.name).toBeTruthy()
      // Lee o modifica: una de las dos, nunca las dos en false.
      const readOnly = tool.annotations?.readOnlyHint === true
      const destructive = tool.annotations?.destructiveHint === true
      expect(readOnly || destructive, `${tool.name} sin readOnlyHint ni destructiveHint`).toBe(true)
      expect(readOnly && destructive, `${tool.name} con las dos anotaciones`).toBe(false)
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(64)
    }
    // Las tres que escriben van marcadas como destructivas.
    const destructivas = tools.filter((tool) => tool.annotations?.destructiveHint === true).map((tool) => tool.name)
    expect(destructivas.sort()).toEqual(['pagatu_create_client', 'pagatu_create_document', 'pagatu_create_quote'])
  })

  it('en modo solo lectura las herramientas de escritura NI SE ANUNCIAN', async () => {
    stubFetch(createFakeBackend())
    const response = await worker.fetch(
      mcpRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
      testEnv({ PAGATU_MCP_WRITE_ENABLED: 'false' }),
    )
    const body = (await response.json()) as JsonRpcResponse
    const names = (body.result?.tools as Array<{ name: string }>).map((tool) => tool.name)
    expect(names).toContain('pagatu_list_clients')
    expect(names).not.toContain('pagatu_create_client')
    expect(names).not.toContain('pagatu_create_quote')
    expect(names).not.toContain('pagatu_create_document')
  })
})

describe('herramientas contra Convex', () => {
  it('lista clientes, los proyecta y aplica search/limit', async () => {
    const backend = createFakeBackend({
      convex: {
        'clients:listClients': {
          value: [
            { _id: 'cl_1', name: 'Ana Pérez', email: 'ana@example.com', profileId: 'pr_1' },
            { _id: 'cl_2', name: 'Carlos Ruiz', email: 'carlos@example.com', profileId: 'pr_1' },
          ],
        },
      },
    })
    const result = await call(toolPayload('pagatu_list_clients', { search: 'ana' }), backend)
    const payload = toolText(result)
    expect(payload).toMatchObject({ total: 1, returned: 1, truncated: false })
    expect(payload.clients).toEqual([{ id: 'cl_1', name: 'Ana Pérez', email: 'ana@example.com' }])
  })

  it('el JWT del usuario viaja a Convex como Bearer', async () => {
    const backend = createFakeBackend({ convex: { 'clients:listClients': { value: [] } } })
    await call(toolPayload('pagatu_list_clients'), backend)
    const convexCall = backend.calls.find((item) => item.url.includes('convex.cloud/api/query'))
    expect(convexCall?.body).toMatchObject({ path: 'clients:listClients' })
    // El token de plantilla se pidió a Clerk antes de llamar a Convex.
    expect(backend.calls.some((item) => item.url.includes('/tokens/convex'))).toBe(true)
  })

  it('un id de otra cuenta responde «no existe», sin filtrar que existe', async () => {
    const backend = createFakeBackend({ convex: { 'clients:getClientById': { value: null } } })
    const result = await call(toolPayload('pagatu_get_client', { clientId: 'cl_de_otro' }), backend)
    expect(result.result?.isError).toBe(true)
    expect(toolText(result)).toMatchObject({ error: { code: 'not_found' } })
  })

  it('crea una cotización SIEMPRE como borrador', async () => {
    const backend = createFakeBackend({ convex: { 'quotes:createQuoteWithItems': { value: 'q_nuevo' } } })
    const result = await call(
      toolPayload('pagatu_create_quote', {
        title: 'Rediseño web',
        items: [{ name: 'Diseño', quantity: 1, unitPrice: 1200 }],
        validUntil: '2026-12-31',
      }),
      backend,
    )
    expect(toolText(result)).toMatchObject({
      created: true,
      documentId: 'q_nuevo',
      status: 'draft',
      url: 'https://app.pagatu.io/documentos/ver/q_nuevo',
    })
    const mutation = backend.calls.find((item) => item.url.includes('/api/mutation'))
    const args = (mutation?.body as { args?: Array<Record<string, unknown>> } | undefined)?.args?.[0]
    // Ni `status` ni nada que pueda emitir el documento.
    expect(args).not.toHaveProperty('status')
    expect(args?.validUntil).toBe(Date.parse('2026-12-31T00:00:00.000Z'))
  })

  it('con validityDays suelto calcula la fecha, porque Convex no lo hace', async () => {
    // Convex solo deriva validUntil cuando no recibe ninguno de los dos
    // (quotes.ts). Con los días sueltos guardaba los días y dejaba el
    // documento sin fecha: comprobado contra la cuenta real.
    const backend = createFakeBackend({ convex: { 'quotes:createQuoteWithItems': { value: 'q_v' } } })
    const antes = Date.now()
    await call(
      toolPayload('pagatu_create_quote', {
        title: 'Con validez',
        items: [{ name: 'Servicio', quantity: 1, unitPrice: 100 }],
        validityDays: 15,
      }),
      backend,
    )
    const mutation = backend.calls.find((item) => item.url.includes('/api/mutation'))
    const args = (mutation?.body as { args?: Array<Record<string, unknown>> } | undefined)?.args?.[0]
    expect(args?.validityDays).toBe(15)
    expect(args?.validUntil).toBeTypeOf('number')
    expect(args?.validUntil as number).toBeGreaterThanOrEqual(antes + 15 * 86_400_000 - 5_000)
  })

  it('una fecha explícita manda sobre los días', async () => {
    const backend = createFakeBackend({ convex: { 'quotes:createQuoteWithItems': { value: 'q_v' } } })
    await call(
      toolPayload('pagatu_create_quote', {
        title: 'Con fecha',
        items: [{ name: 'Servicio', quantity: 1, unitPrice: 100 }],
        validityDays: 15,
        validUntil: '2027-01-31',
      }),
      backend,
    )
    const mutation = backend.calls.find((item) => item.url.includes('/api/mutation'))
    const args = (mutation?.body as { args?: Array<Record<string, unknown>> } | undefined)?.args?.[0]
    expect(args?.validUntil).toBe(Date.parse('2027-01-31T00:00:00.000Z'))
  })

  it('crea un documento PROFESIONAL del tipo pedido, siempre en borrador', async () => {
    const backend = createFakeBackend({ convex: { 'quotes:createProDocument': { value: 'doc_pro' } } })
    const result = await call(
      toolPayload('pagatu_create_document', {
        title: 'Contrato de servicios',
        documentType: 'contract',
        language: 'en',
        clientName: 'Acme LLC',
      }),
      backend,
    )
    expect(toolText(result)).toMatchObject({
      created: true,
      documentId: 'doc_pro',
      documentType: 'contract',
      status: 'draft',
      editor: 'https://app.pagatu.io/documentos/documento/doc_pro',
    })
    const mutation = backend.calls.find((item) => item.url.includes('/api/mutation'))
    const body = mutation?.body as { path?: string; args?: Array<Record<string, unknown>> } | undefined
    expect(body?.path).toBe('quotes:createProDocument')
    expect(body?.args?.[0]).toMatchObject({ documentType: 'contract', language: 'en' })
    // Ni estado ni contenido: el borrador y el cuerpo los decide Pagatu.
    expect(body?.args?.[0]).not.toHaveProperty('status')
    expect(body?.args?.[0]).not.toHaveProperty('content')
  })

  it('rechaza un tipo de documento que Pagatu no tiene', async () => {
    const backend = createFakeBackend({ convex: { 'quotes:createProDocument': { value: 'x' } } })
    const result = await call(
      toolPayload('pagatu_create_document', { title: 'Algo', documentType: 'factura_electronica' }),
      backend,
    )
    expect(result.error ?? result.result?.isError).toBeTruthy()
    expect(backend.calls.some((item) => item.url.includes('/api/mutation'))).toBe(false)
  })

  it('las plantillas salen sin el cuerpo de la plantilla', async () => {
    const backend = createFakeBackend({
      convex: {
        'documentTemplates:listTemplates': {
          value: [
            {
              _id: 'tpl_1',
              name: 'Contrato de servicios',
              category: 'legal',
              documentType: 'contract',
              language: 'es',
              isSystem: true,
              contentJson: '{"enorme":"' + 'x'.repeat(3000) + '"}',
              content: { body: 'x'.repeat(3000) },
            },
          ],
        },
      },
    })
    const result = await call(toolPayload('pagatu_list_document_templates', { documentType: 'contract' }), backend)
    const payload = toolText(result)
    expect(payload).toMatchObject({ count: 1 })
    expect((payload.templates as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 'tpl_1', isSystem: true })
    expect(JSON.stringify(payload).length).toBeLessThan(500)
  })

  it('valida los argumentos antes de tocar Convex', async () => {
    const backend = createFakeBackend({ convex: { 'quotes:createQuoteWithItems': { value: 'q' } } })
    const result = await call(toolPayload('pagatu_create_quote', { title: 'Sin líneas', items: [] }), backend)
    expect(result.error ?? result.result?.isError).toBeTruthy()
    expect(backend.calls.some((item) => item.url.includes('/api/mutation'))).toBe(false)
  })

  it('un límite de plan llega al modelo como mensaje accionable', async () => {
    const backend = createFakeBackend({
      convex: {
        'clients:createClient': { error: 'PLAN_LIMIT_CLIENTS', errorData: { code: 'PLAN_LIMIT_CLIENTS' } },
      },
    })
    const result = await call(toolPayload('pagatu_create_client', { name: 'Nueva SAC' }), backend)
    expect(result.result?.isError).toBe(true)
    expect(toolText(result)).toMatchObject({ error: { code: 'plan_limit_clients' } })
  })

  it('sin sesión de navegador abierta, la herramienta responde igual', async () => {
    // Antes esto devolvía «inicia sesión» y dejaba el conector inservible en
    // cuanto el usuario cerraba Pagatu. Ahora el Worker crea la sesión.
    const backend = createFakeBackend({ sessions: [], convex: { 'clients:listClients': { value: [] } } })
    const result = await call(toolPayload('pagatu_list_clients'), backend)
    expect(result.result?.isError).toBeFalsy()
    expect(toolText(result)).toMatchObject({ total: 0 })
  })

  it('si Clerk no deja crear la sesión, la herramienta pide iniciar sesión en Pagatu', async () => {
    const backend = createFakeBackend({
      sessions: [],
      signInToken: { status: 403, body: {} },
      convex: { 'clients:listClients': { value: [] } },
    })
    const result = await call(toolPayload('pagatu_list_clients'), backend)
    expect(result.result?.isError).toBe(true)
    const payload = toolText(result) as { error: { code: string; message: string } }
    expect(payload.error.code).toBe('pagatu_session_required')
    expect(payload.error.message).toContain('https://app.pagatu.io')
  })

  it('los métodos de cobro salen sin número de cuenta', async () => {
    const backend = createFakeBackend({
      convex: {
        'paymentMethods:listMyPaymentMethods': {
          value: [
            {
              _id: 'pm_1',
              type: 'bank_account',
              category: 'bank',
              holderName: 'Ana Pérez',
              data: { accountNumber: '19100000000000' },
            },
          ],
        },
      },
    })
    const result = await call(toolPayload('pagatu_list_payment_methods'), backend)
    const raw = JSON.stringify(toolText(result))
    expect(raw).toContain('pm_1')
    expect(raw).not.toContain('19100000000000')
  })

  it('las facturas salen en unidades y con el pendiente por moneda', async () => {
    const backend = createFakeBackend({
      convex: {
        'invoices:listInvoices': {
          value: [
            {
              invoice: { _id: 'inv_1', number: 'F001-1', status: 'issued', currency: 'PEN', totalCents: 35400 },
              displayStatus: 'partial',
              collectedCents: 10000,
              balanceCents: 25400,
            },
            {
              invoice: { _id: 'inv_2', number: 'F001-2', status: 'issued', currency: 'USD', totalCents: 20000 },
              displayStatus: 'issued',
              collectedCents: 0,
              balanceCents: 20000,
            },
          ],
        },
      },
    })
    const result = await call(toolPayload('pagatu_list_invoices'), backend)
    const payload = toolText(result)
    expect(payload.count).toBe(2)
    // Dos monedas, dos pendientes: nunca una suma única.
    expect(payload.pendingByCurrency).toEqual({ PEN: 254, USD: 200 })
  })

  it('los cobros se filtran por estado efectivo', async () => {
    const backend = createFakeBackend({
      convex: {
        'payments:listPayments': {
          value: [
            { _id: 'p1', concept: 'Anticipo web', currency: 'PEN', amount: 500, balanceAmount: 300, effectiveStatus: 'overdue' },
            { _id: 'p2', concept: 'Mantenimiento', currency: 'PEN', amount: 200, balanceAmount: 0, effectiveStatus: 'paid' },
          ],
        },
      },
    })
    const result = await call(toolPayload('pagatu_list_payments', { status: 'overdue' }), backend)
    const payload = toolText(result)
    expect(payload).toMatchObject({ total: 1, pendingByCurrency: { PEN: 300 } })
    expect((payload.payments as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 'p1', status: 'overdue' })
  })

  it('una factura de otra cuenta responde «no existe»', async () => {
    const backend = createFakeBackend({ convex: { 'invoices:getInvoice': { value: null } } })
    const result = await call(toolPayload('pagatu_get_invoice', { invoiceId: 'inv_ajena' }), backend)
    expect(result.result?.isError).toBe(true)
    expect(toolText(result)).toMatchObject({ error: { code: 'not_found' } })
  })

  it('la agenda sin rango consulta las próximas cuatro semanas', async () => {
    const backend = createFakeBackend({ convex: { 'agenda:listAppointments': { value: [] } } })
    await call(toolPayload('pagatu_list_appointments'), backend)
    const query = backend.calls.find((item) => item.url.includes('/api/query'))
    const args = (query?.body as { args?: Array<Record<string, number>> } | undefined)?.args?.[0]
    expect(args?.startAt).toBeTypeOf('number')
    expect((args?.endAt ?? 0) - (args?.startAt ?? 0)).toBe(28 * 86_400_000)
  })

  it('un rango invertido se rechaza sin llamar a Convex', async () => {
    const backend = createFakeBackend({ convex: { 'agenda:listAppointments': { value: [] } } })
    const result = await call(
      toolPayload('pagatu_list_appointments', { from: '2026-05-10', to: '2026-05-01' }),
      backend,
    )
    expect(toolText(result)).toMatchObject({ error: { code: 'invalid_range' } })
    expect(backend.calls.some((item) => item.url.includes('/api/query'))).toBe(false)
  })
})
