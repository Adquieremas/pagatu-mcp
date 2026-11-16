# Pagatu MCP

Servidor **MCP remoto** de [Pagatu.io](https://pagatu.io): expone la cuenta del
usuario (clientes, documentos, agenda y métodos de cobro) a clientes MCP como
**Claude** y **Codex**, sobre Cloudflare Workers y **Streamable HTTP**.

- Endpoint MCP: `https://mcp.pagatu.io/mcp`
- Transporte: Streamable HTTP **sin estado** (sin `Mcp-Session-Id`, sin SSE)
- Autorización: OAuth 2.1 con **Clerk** como Authorization Server
- Datos: el **Convex existente** de Pagatu, llamado con la identidad del usuario

## Qué es y qué no es

Este Worker es un **traductor**, no un backend:

- **No tiene base de datos propia** ni caché de datos de negocio.
- **No duplica lógica**: cada herramienta llama a una función de Convex que ya
  existe (`convex/clients.ts`, `convex/quotes.ts`, `convex/agenda.ts`,
  `convex/paymentMethods.ts`, `convex/profiles.ts`). La lista completa y
  cerrada está en [`src/convex/functions.ts`](src/convex/functions.ts).
- **No usa credenciales de administrador de Convex.** No hay deploy key ni
  admin key: cada llamada va firmada con el JWT de Clerk *del usuario*
  (template `convex`), el mismo que usa el navegador, así que Convex aplica las
  mismas reglas de propiedad (`profileId`) que a la app. Un usuario solo puede
  ver y escribir lo suyo.
- **No mueve dinero y no destruye nada**: no hay pagos, ni emisión de
  documentos, ni envíos al cliente, ni borrados, ni cambios de estado.

## Arquitectura

```
Claude / Codex
     │  1. POST /mcp sin token        → 401 + WWW-Authenticate (resource_metadata)
     │  2. GET  /.well-known/oauth-protected-resource/mcp
     │  3. OAuth 2.1 + PKCE contra Clerk (registro dinámico de cliente)
     ▼
┌─────────────────────────────┐   verify token      ┌──────────┐
│  Worker  mcp.pagatu.io/mcp  │ ──────────────────► │  Clerk   │
│  (MCP SDK + Streamable HTTP)│ ◄────────────────── │ (BAPI)   │
└──────────────┬──────────────┘   JWT «convex»      └──────────┘
               │  Bearer = JWT del usuario
               ▼
        ┌────────────────┐
        │ Convex Pagatu  │  queries/mutations públicas ya existentes
        └────────────────┘
```

Por petición: se verifica el Bearer contra Clerk
(`POST /v1/oauth_applications/access_tokens/verify`), se firma un JWT del
template `convex` desde la sesión activa de Clerk de ese usuario
(`POST /v1/sessions/{id}/tokens/convex`) y se llama a Convex con él. Las dos
respuestas se cachean en memoria unos segundos para no repetir la pregunta
dentro de la misma ráfaga de llamadas.

### Estructura

```
src/
├── index.ts              Worker: rutas, CORS, errores HTTP
├── server.ts             McpServer (uno por petición) + instrucciones
├── env.ts                Variables de entorno y validación
├── errors.ts             Errores y traducción de los de Convex
├── http.ts               CORS y respuestas JSON / JSON-RPC
├── logging.ts            Log JSON sin datos personales
├── cache.ts              Caché TTL en memoria (hash de secretos)
├── auth/
│   ├── clerk.ts          Backend API de Clerk (verificar token, firmar JWT)
│   ├── session.ts        Bearer → identidad, 401/403
│   ├── metadata.ts       Descubrimiento OAuth (RFC 9728)
│   └── permissions.ts    Permiso por operación (lectura / escritura / scopes)
├── convex/
│   ├── functions.ts      LISTA BLANCA de funciones Convex llamables
│   └── client.ts         ConvexHttpClient con el JWT del usuario
└── tools/                Herramientas MCP por dominio + proyecciones
```

## Herramientas

| Herramienta | Tipo | Función de Convex |
| --- | --- | --- |
| `pagatu_whoami` | lectura | `profiles:getCurrentProfile` |
| `pagatu_list_clients` | lectura | `clients:listClients` |
| `pagatu_get_client` | lectura | `clients:getClientById` |
| `pagatu_create_client` | escritura | `clients:createClient` |
| `pagatu_list_documents` | lectura | `quotes:listQuotesPage` |
| `pagatu_get_document` | lectura | `quotes:getQuote` |
| `pagatu_create_quote` | escritura | `quotes:createQuoteWithItems` |
| `pagatu_list_appointments` | lectura | `agenda:listAppointments` |
| `pagatu_agenda_overview` | lectura | `agenda:getAgendaOverview` |
| `pagatu_list_services` | lectura | `agenda:listServices` |
| `pagatu_list_payment_methods` | lectura | `paymentMethods:listMyPaymentMethods` |
| `pagatu_list_invoices` | lectura | `invoices:listInvoices` |
| `pagatu_get_invoice` | lectura | `invoices:getInvoice` |
| `pagatu_list_payments` | lectura | `payments:listPayments` |

Notas que importan:

- `pagatu_create_quote` crea **siempre un borrador**: no envía `status`, así que
  Convex deja el documento en `draft`, que no consume correlativo ni sale del
  escritorio de su dueño.
- `pagatu_list_payment_methods` **no devuelve** el dato de cobro (cuenta, CCI,
  IBAN, alias de billetera ni la clave del QR).
- `pagatu_get_document` no devuelve el contenido del editor (`richContent`) ni
  el token público del documento.
- **Facturas y cobros son solo lectura.** `createInvoiceDraft`, `issueInvoice`
  y `createPayment` existen en Convex y NO se exponen: emitir consume
  correlativo y registrar un cobro es un hecho contable.
- El estado de una factura y de un cobro es el EFECTIVO (vencida, parcial,
  pagada), que Pagatu deriva del ledger y del reloj; el estado guardado va
  aparte en `storedStatus`.
- Las facturas guardan el dinero en céntimos y el MCP lo devuelve en unidades
  de la moneda. El pendiente se agrupa POR MONEDA, nunca en una suma única.
- `search` y `limit` de `pagatu_list_clients` filtran lo que Convex ya devolvió
  (`listClients` no acepta filtros); `pagatu_list_documents` sí usa la búsqueda
  y la paginación reales de Convex.

## Entornos

Los tres valores de identidad —issuer de Clerk, Convex y la clave secreta—
tienen que ser **del mismo entorno**. Mezclarlos no falla a medias: Clerk firma
un JWT cuyo issuer el `auth.config.ts` de ese Convex no reconoce, y toda
llamada muere en `NOT_AUTHENTICATED`.

| | Local (`.dev.vars`) | Producción (`wrangler.jsonc` + secret) |
| --- | --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | `https://joint-glowworm-55.clerk.accounts.dev` | `https://clerk.pagatu.io` |
| `CONVEX_URL` | `https://peaceful-woodpecker-797.convex.cloud` (dev) | `https://peaceful-swordfish-460.convex.cloud` |
| `CLERK_SECRET_KEY` | `sk_test_…` | `sk_live_…` (solo como secret) |
| `PAGATU_APP_URL` | `http://localhost:4321` | `https://app.pagatu.io` |
| `PAGATU_MCP_PUBLIC_URL` | `http://localhost:8787` | `https://mcp.pagatu.io` |

La URL de Convex y el issuer de Clerk no son secretos (ya viajan en el cliente
de la app), así que viven en `wrangler.jsonc` versionado. El único secreto es
`CLERK_SECRET_KEY`.

### Comprobar la conexión con Clerk

```bash
npm run check:clerk
```

Verifica contra el Clerk real las tres cosas de las que depende el MCP: que el
endpoint de verificación de tokens OAuth responde, que existe el JWT template
`convex` y que se puede firmar ese token desde una sesión activa. Lee
`.dev.vars`; para apuntar a producción, `CLERK_SECRET_KEY=sk_live_… npm run
check:clerk`. No imprime ni la clave ni el JWT.

## Puesta en marcha (local)

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

Rellena `.dev.vars` (ver `.env.example` para la descripción de cada variable) y
arranca:

```bash
npm run dev
```

Comprobación rápida de que el Worker vive:

```bash
curl -s http://localhost:8787/health
```

Y de que anuncia bien su Authorization Server:

```bash
curl -s http://localhost:8787/.well-known/oauth-protected-resource/mcp
```

### Calidad

```bash
npm run check
```

(`typecheck` + `lint` + `test`; también por separado: `npm run typecheck`,
`npm run lint`, `npm test`.)

Comprobar que el bundle de Workers compila, **sin desplegar**:

```bash
npm run deploy:dry
```

## Configuración en Clerk (una sola vez)

En el dashboard de la **misma instancia de Clerk** que usa la app de Pagatu:

1. **JWT template `convex`** — ya existe para la app. Este Worker lo reutiliza;
   no hace falta crear otro.
2. **Configure → OAuth Applications → Dynamic Client Registration: activado.**
   Sin esto, Clerk no publica `registration_endpoint` y los clientes MCP no
   pueden registrarse solos.
3. Scopes disponibles para los clientes: `profile` y `email` bastan — la
   autorización real la hace Convex con la identidad del usuario.

Ojo: **dev y producción son dos dashboards distintos**, así que la activación
de DCR hay que hacerla en cada instance por separado.

No hay que tocar nada en Convex: `convex/auth.config.ts` ya confía en esa
instancia de Clerk con `applicationID: 'convex'`.

## Despliegue (cuando toque)

```bash
npx wrangler secret put CLERK_SECRET_KEY
```

```bash
npm run deploy
```

El dominio `mcp.pagatu.io` está declarado en `wrangler.jsonc` como
`custom_domain`, y `workers_dev` está desactivado para que el MCP no quede
también expuesto en `*.workers.dev`.

> Este repositorio **no se ha desplegado todavía**: está preparado para hacerlo.

## Conectar Claude

Claude.ai / Claude Desktop → **Settings → Connectors → Add custom connector**:

- Nombre: `Pagatu`
- URL: `https://mcp.pagatu.io/mcp`

Claude descubre el Authorization Server por los metadatos, se registra en Clerk
por DCR y abre el inicio de sesión de Pagatu. Al autorizar, las herramientas
`pagatu_*` quedan disponibles.

Claude Code, por CLI:

```bash
claude mcp add --transport http pagatu https://mcp.pagatu.io/mcp
```

## Conectar Codex

```bash
codex mcp add pagatu --url https://mcp.pagatu.io/mcp
```

Un solo comando: Codex detecta que el servidor pide OAuth, abre el navegador,
completa el flujo contra Clerk y guarda el token («Detected OAuth support…
Successfully logged in»). En `~/.codex/config.toml` deja:

```toml
[mcp_servers.pagatu]
url = "https://mcp.pagatu.io/mcp"
```

Comprobar que quedó bien:

```bash
codex mcp list
```

La fila `pagatu` debe decir `enabled` y `Auth: OAuth`. Si la app de Codex está
instalada pero `codex` no está en el PATH, el binario vive en
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`.

## Seguridad

- **Un usuario, sus datos.** La propiedad la decide Convex a partir del JWT del
  usuario; el Worker no tiene forma de pedir datos «de todos».
- **Ids opacos.** Un id inexistente y uno de otra cuenta devuelven el mismo
  `not_found`: el MCP no revela qué ids existen en otras cuentas.
- **Errores sin filtraciones.** Los errores de Convex se traducen a códigos
  estables; ningún mensaje interno ni stack llega al modelo.
- **Permisos por operación.** Las herramientas declaran lectura o escritura;
  con `PAGATU_MCP_WRITE_ENABLED=false` las de escritura no se registran y por
  tanto no se anuncian.
- **Logs sin datos personales.** Se registra el `clerkId` truncado, la
  herramienta y la duración; nunca tokens, emails ni contenido.
- **Secretos fuera de git.** `.dev.vars`, `.env` y variantes están en
  `.gitignore`; en producción son `wrangler secret`.

## Limitación conocida

Firmar el JWT de Convex requiere una **sesión activa de Clerk** del usuario (es
la misma condición que tiene la app). Si alguien autorizó el MCP y lleva mucho
tiempo sin abrir Pagatu, la herramienta responde
`pagatu_session_required` y pide iniciar sesión en la app. La alternativa
—emitir un JWT propio del Worker— exigiría añadir un segundo proveedor en
`convex/auth.config.ts` y redesplegar Convex, que queda fuera del alcance de
este repositorio.
