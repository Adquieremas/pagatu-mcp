/**
 * Proyecciones de lo que devuelve Convex hacia lo que ve el modelo.
 *
 * Dos razones para no reenviar el documento crudo:
 *
 * - CONTEXTO. Un documento de Pagatu lleva `richContent` (el JSON del editor),
 *   snapshots de marca y de firma… cientos de KB que no aportan nada a «¿qué
 *   cotizaciones tengo pendientes?» y que se comerían la ventana del modelo.
 * - SUPERFICIE. Lo que no se proyecta no se filtra. Tokens, claves de R2 y
 *   metadatos internos no salen de Convex por este camino.
 *
 * Los campos se leen con tolerancia (`pick*`) porque el shape real de Pagatu
 * tiene campos heredados: una ficha vieja puede no tener `clientType` y una
 * nueva sí. Lo que falta se omite; nada se inventa.
 */

type Row = Record<string, unknown>

function str(row: Row, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(row: Row, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function strArray(row: Row, key: string): string[] | undefined {
  const value = row[key]
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items : undefined
}

/** Epoch ms → ISO, para que el modelo no tenga que convertir timestamps. */
function iso(row: Row, key: string): string | undefined {
  const value = num(row, key)
  if (value === undefined) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Quita las claves sin valor para que el JSON que ve el modelo sea corto. */
function compact<T extends Row>(row: T): Row {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== null))
}

export function asRow(value: unknown): Row | null {
  return typeof value === 'object' && value !== null ? (value as Row) : null
}

export function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => typeof item === 'object' && item !== null) : []
}

/**
 * CÉNTIMOS → unidades de la moneda.
 *
 * Las facturas guardan el dinero en céntimos enteros (`totalCents`), mientras
 * que documentos y cobros lo guardan en unidades. Devolver las dos cosas con
 * el mismo nombre haría que un total de 354,00 apareciera unas veces como 354
 * y otras como 35400: la diferencia entre una factura correcta y una cien
 * veces mayor. Aquí se convierte una sola vez, en la frontera.
 */
function fromCents(row: Row, key: string): number | undefined {
  const value = num(row, key)
  return value === undefined ? undefined : Math.round(value) / 100
}

export function clientSummary(row: Row): Row {
  return compact({
    id: str(row, '_id'),
    name: str(row, 'name'),
    businessName: str(row, 'businessName') ?? str(row, 'razonSocial'),
    clientType: str(row, 'clientType'),
    status: str(row, 'status'),
    email: str(row, 'email'),
    phone: str(row, 'phone'),
    whatsapp: str(row, 'whatsapp'),
    documentType: str(row, 'documentType'),
    documentNumber: str(row, 'documentNumber'),
    countryCode: str(row, 'countryCode'),
    city: str(row, 'city'),
    preferredCurrency: str(row, 'preferredCurrency'),
    tags: strArray(row, 'tags'),
    listName: str(row, 'listName'),
    nextAction: str(row, 'nextAction'),
    nextActionAt: iso(row, 'nextActionAt'),
    updatedAt: iso(row, 'updatedAt'),
  })
}

export function clientDetail(row: Row): Row {
  return compact({
    ...clientSummary(row),
    address: str(row, 'address'),
    district: str(row, 'district'),
    province: str(row, 'province'),
    region: str(row, 'region'),
    postalCode: str(row, 'postalCode'),
    website: str(row, 'website'),
    contactoPrincipal: str(row, 'contactoPrincipal'),
    contactRole: str(row, 'contactRole'),
    paymentTerms: str(row, 'paymentTerms'),
    creditDays: num(row, 'creditDays'),
    notes: str(row, 'notes'),
    createdAt: iso(row, 'createdAt'),
  })
}

export function documentSummary(row: Row): Row {
  return compact({
    id: str(row, '_id'),
    number: str(row, 'quoteNumber') ?? str(row, 'documentNumber'),
    title: str(row, 'title'),
    documentType: str(row, 'documentType') ?? 'quote',
    status: str(row, 'status'),
    category: str(row, 'category'),
    clientId: str(row, 'clientId'),
    clientName: str(row, 'clientName') ?? str(row, 'clientDisplayName') ?? str(row, 'clientBusinessName'),
    currency: str(row, 'currency'),
    subtotal: num(row, 'subtotal'),
    discount: num(row, 'discount'),
    tax: num(row, 'tax'),
    total: num(row, 'total'),
    isSigned: typeof row.isSigned === 'boolean' ? row.isSigned : undefined,
    signedAt: iso(row, 'signedAt') ?? iso(row, 'acceptedAt'),
    issuedAt: iso(row, 'issuedAt'),
    validUntil: iso(row, 'validUntil'),
    // Los días pactados viajan aparte de la fecha: un documento puede tener
    // los días guardados sin fecha calculada (Convex solo la deriva en su
    // rama por defecto), y ocultarlo haría invisible la validez que se pidió.
    validityDays: num(row, 'validityDays'),
    updatedAt: iso(row, 'updatedAt'),
  })
}

export function documentItem(row: Row): Row {
  return compact({
    name: str(row, 'name'),
    description: str(row, 'description'),
    quantity: num(row, 'quantity'),
    unitPrice: num(row, 'unitPrice'),
    total: num(row, 'total'),
  })
}

export function documentDetail(row: Row): Row {
  const client = asRow(row.clientSnapshot)
  return compact({
    ...documentSummary(row),
    description: str(row, 'description'),
    scope: str(row, 'scope'),
    paymentTerms: str(row, 'paymentTerms'),
    conditions: str(row, 'conditions'),
    observations: str(row, 'observations'),
    notes: str(row, 'notes'),
    estimatedTime: str(row, 'estimatedTime'),
    client: client
      ? compact({
          name: str(client, 'name') ?? str(client, 'clientName'),
          documentNumber: str(client, 'documentNumber'),
          email: str(client, 'email'),
        })
      : undefined,
    items: asRows(row.items).map(documentItem),
  })
}

export function appointmentSummary(row: Row): Row {
  const client = asRow(row.client)
  const service = asRow(row.service)
  return compact({
    id: str(row, '_id'),
    title: str(row, 'title') ?? service?.name,
    status: str(row, 'status'),
    startAt: iso(row, 'startAt'),
    endAt: iso(row, 'endAt'),
    location: str(row, 'location'),
    meetingUrl: str(row, 'meetingUrl'),
    notes: str(row, 'notes'),
    clientId: str(row, 'clientId'),
    clientName: client ? str(client, 'name') : str(row, 'clientName'),
    serviceId: str(row, 'serviceId'),
    serviceName: service ? str(service, 'name') : undefined,
    servicePrice: service ? num(service, 'price') : undefined,
  })
}

export function serviceSummary(row: Row): Row {
  return compact({
    id: str(row, '_id'),
    name: str(row, 'name'),
    description: str(row, 'description'),
    durationMinutes: num(row, 'durationMinutes') ?? num(row, 'duration'),
    price: num(row, 'price'),
    currency: str(row, 'currency'),
    isActive: typeof row.isActive === 'boolean' ? row.isActive : undefined,
  })
}

/**
 * Método de cobro SIN el detalle sensible.
 *
 * `data` lleva el número de cuenta, el CCI, el IBAN o el alias de billetera.
 * Eso es lo que se usa para que a alguien le paguen: no tiene por qué pasar
 * por un modelo para responder «¿qué métodos de cobro tengo?». Se devuelve el
 * tipo, el titular y el alias, que es con lo que un humano los distingue.
 */
export function paymentMethodSummary(row: Row): Row {
  return compact({
    id: str(row, '_id'),
    type: str(row, 'type'),
    category: str(row, 'category'),
    name: str(row, 'name'),
    aliasInterno: str(row, 'aliasInterno'),
    holderName: str(row, 'holderName'),
    countryCode: str(row, 'countryCode'),
    providerKey: str(row, 'providerKey'),
    currency: str(row, 'currency'),
    isActive: typeof row.isActive === 'boolean' ? row.isActive : undefined,
    sortOrder: num(row, 'sortOrder'),
  })
}

/**
 * El plan se lee de `effectiveAccess`, NUNCA del campo `plan`.
 *
 * `plan` no sale de Convex a propósito (`SERVER_ONLY_PROFILE_FIELDS`): es una
 * caché derivada de las suscripciones que puede ir por detrás de la realidad
 * —una cuenta con el pase caducado conserva ahí su `pro`— y leerla es, en
 * palabras del propio Pagatu, «la forma más fácil de autorizar por el sitio
 * equivocado». Lo que el servidor publica ya resuelto es `effectiveAccess`,
 * con el plan de facturación, el acceso efectivo y el nombre para mostrar.
 *
 * La primera versión de esto pedía `plan` y por eso la respuesta salía sin
 * plan: no faltaba el dato, es que se estaba mirando donde no se debe.
 */
export function profileSummary(row: Row): Row {
  const access = asRow(row.effectiveAccess)
  return compact({
    id: str(row, '_id'),
    name: str(row, 'name'),
    email: str(row, 'email'),
    // Acceso EFECTIVO (lo que la cuenta puede hacer hoy), no la caché de plan.
    plan: access ? str(access, 'accessPlan') : undefined,
    planLabel: access ? str(access, 'displayName') : undefined,
    billingPlan: access ? str(access, 'billingPlan') : undefined,
    country: str(row, 'countryCode') ?? str(row, 'country'),
    currency: str(row, 'defaultCurrency') ?? str(row, 'currency'),
    businessName: str(row, 'businessName'),
    onboardingCompleted: typeof row.onboardingCompleted === 'boolean' ? row.onboardingCompleted : undefined,
  })
}


/**
 * Factura: lo que hace falta para saber si está cobrada y por cuánto.
 *
 * `listInvoices` y `getInvoice` devuelven una VISTA —`{ invoice, lines,
 * displayStatus, collectedCents, balanceCents, counterparty }`—, no la fila
 * cruda, así que el estado que vale es `displayStatus` (deriva vencida,
 * parcial y pagada del ledger y del reloj; la tabla solo persiste draft,
 * issued y void).
 *
 * Fuera quedan `publicToken` (abre la factura a cualquiera que lo tenga),
 * `issuerSnapshot` y `recipientSnapshot` crudos y las claves de idempotencia.
 */
export function invoiceSummary(view: Row): Row {
  const invoice = asRow(view.invoice) ?? view
  const counterparty = asRow(view.counterparty)
  return compact({
    id: str(invoice, '_id'),
    number: str(invoice, 'number'),
    status: str(view, 'displayStatus') ?? str(invoice, 'status'),
    storedStatus: str(invoice, 'status'),
    currency: str(invoice, 'currency'),
    subtotal: fromCents(invoice, 'subtotalCents'),
    tax: fromCents(invoice, 'taxCents'),
    taxLabel: str(invoice, 'taxLabel'),
    total: fromCents(invoice, 'totalCents'),
    collected: fromCents(view, 'collectedCents'),
    balance: fromCents(view, 'balanceCents'),
    clientId: str(invoice, 'clientId'),
    clientName: counterparty
      ? str(counterparty, 'name') ?? str(counterparty, 'businessName') ?? str(counterparty, 'razonSocial')
      : undefined,
    reference: str(invoice, 'reference'),
    issuedAt: iso(invoice, 'issuedAt'),
    dueDate: iso(invoice, 'dueDate'),
    sentAt: iso(invoice, 'sentAt'),
    voidedAt: iso(invoice, 'voidedAt'),
    updatedAt: iso(invoice, 'updatedAt'),
  })
}

export function invoiceLine(row: Row): Row {
  const taxRateBps = num(row, 'taxRateBps')
  return compact({
    description: str(row, 'description'),
    quantity: num(row, 'quantity'),
    unitPrice: fromCents(row, 'unitPriceCents'),
    // Puntos básicos → porcentaje: 1800 = 18 %.
    taxRate: taxRateBps === undefined ? undefined : taxRateBps / 100,
    subtotal: fromCents(row, 'lineSubtotalCents'),
    tax: fromCents(row, 'lineTaxCents'),
    total: fromCents(row, 'lineTotalCents'),
  })
}

export function invoiceDetail(view: Row): Row {
  const invoice = asRow(view.invoice) ?? view
  const counterparty = asRow(view.counterparty)
  return compact({
    ...invoiceSummary(view),
    notes: str(invoice, 'notes'),
    sourceDocumentId: str(invoice, 'sourceDocumentId'),
    revision: num(invoice, 'revision'),
    voidReason: str(invoice, 'voidReason'),
    client: counterparty
      ? compact({
          name: str(counterparty, 'name') ?? str(counterparty, 'businessName'),
          taxId: str(counterparty, 'taxId'),
          taxIdLabel: str(counterparty, 'taxIdLabel'),
          email: str(counterparty, 'email'),
          address: str(counterparty, 'address'),
        })
      : undefined,
    lines: asRows(view.lines).map(invoiceLine),
  })
}

/**
 * Cobro: importe, cuánto se recibió y qué falta.
 *
 * El estado que cuenta es `effectiveStatus`, derivado de los abonos y del
 * reloj —«vencido» no se guarda en la tabla, porque un estado que depende de
 * la hora envejece solo—. Los importes vienen en unidades, no en céntimos.
 *
 * Fuera quedan `transactionCode` y el detalle del método: son datos de la
 * operación bancaria, no hacen falta para responder «qué me han pagado», y el
 * nombre enmascarado del método (`paymentMethodMasked`) ya identifica cuál es.
 */
export function paymentSummary(row: Row): Row {
  return compact({
    id: str(row, '_id'),
    concept: str(row, 'concept'),
    status: str(row, 'effectiveStatus') ?? str(row, 'status'),
    currency: str(row, 'currency'),
    amount: num(row, 'amount'),
    received: num(row, 'receivedAmount'),
    balance: num(row, 'balanceAmount'),
    paymentDate: iso(row, 'paymentDate'),
    dueDate: iso(row, 'dueDate'),
    clientId: str(row, 'clientId'),
    clientName: str(row, 'clientName'),
    documentId: str(row, 'quoteId'),
    documentNumber: str(row, 'quoteNumber'),
    documentTitle: str(row, 'quoteTitle'),
    invoiceId: str(row, 'invoiceId'),
    category: str(row, 'categoryName'),
    method: str(row, 'paymentMethodName'),
    methodMasked: str(row, 'paymentMethodMasked'),
    installments: asRows(row.installments).length || undefined,
    reference: str(row, 'reference'),
  })
}

/**
 * Plantilla de documento: lo justo para elegir una.
 *
 * `content` y `contentJson` llevan el cuerpo entero de la plantilla —miles de
 * caracteres— y no hacen falta para decidir cuál usar: el editor los aplica
 * en el servidor al crear el documento.
 */
export function templateSummary(row: Row): Row {
  return compact({
    id: str(row, '_id'),
    name: str(row, 'name'),
    description: str(row, 'description'),
    category: str(row, 'category'),
    documentType: str(row, 'documentType'),
    language: str(row, 'language') ?? 'es',
    // Del sistema o propia: cambia quién la mantiene y si se puede borrar.
    isSystem: typeof row.isSystem === 'boolean' ? row.isSystem : undefined,
  })
}
