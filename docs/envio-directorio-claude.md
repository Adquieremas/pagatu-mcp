# Envío al directorio de conectores de Claude

Texto listo para pegar en `claude.ai/directory/manage` → **Submit new** → **MCP
connector**. Los pasos del formulario van en el mismo orden que el portal.

Requisitos leídos el 27/11/2026 en `claude.com/docs/directory/publish`,
`connectors/building/review-criteria`, `connectors/building/submission` y
`connectors/building/authentication`. Si el formulario pide algo que no está
aquí, gana el formulario.

> **Antes de enviar, dos cosas sin resolver** (detalle al final):
> 1. La URL de documentación tiene que ser **pública**; hoy el repositorio es privado.
> 2. Conviene comprobar que Cloudflare no reta a los servidores de Anthropic
>    (`160.79.104.0/21`) en el descubrimiento OAuth.

---

## 1. Connection

| Campo | Valor |
| --- | --- |
| Server URL | `https://mcp.pagatu.io/mcp` |

El `resource` de los metadatos es exactamente esa URL, que es lo que exige la
revisión. No uses el dominio sin `/mcp`.

---

## 2. Tools

Se sincronizan solas desde el servidor. Deben aparecer **16**: 13 de solo
lectura y 3 de escritura. Las tres de escritura (`pagatu_create_client`,
`pagatu_create_quote`, `pagatu_create_document`) tienen que salir marcadas
como destructivas; si no, el servidor desplegado es anterior a la versión
`a89fda35` y hay que volver a desplegar antes de enviar.

---

## 3. Listing

**Name** (≤100)

```
Pagatu
```

**Short description** (≤200 · usa 156)

```
Conecta tu cuenta de Pagatu: consulta clientes, documentos, agenda, facturas y cobros, y crea clientes, cotizaciones y documentos profesionales en borrador.
```

**Long description** (≤2.000 · usa 1.648)

```
Pagatu es la plataforma donde freelancers y pequeños estudios de Perú y LATAM llevan sus clientes, sus documentos comerciales, su agenda y sus cobros. Este conector te deja trabajar con esa misma cuenta desde Claude, sin salir de la conversación.

Qué puedes hacer leyendo:
• Clientes: buscar en tu cartera y abrir la ficha completa de uno.
• Documentos: listar cotizaciones, propuestas, contratos y acuerdos con su estado, y ver sus líneas e importes.
• Agenda: consultar tus citas por rango de fechas, el resumen del día y los servicios reservables.
• Facturas: ver cuáles están emitidas, cobradas, parciales o vencidas, con lo cobrado y el saldo.
• Cobros: revisar qué te han pagado y cuánto queda pendiente, agrupado por moneda.
• Métodos de cobro: saber cuáles tienes configurados.

Qué puedes hacer escribiendo, siempre en borrador:
• Crear un cliente.
• Crear una cotización rápida con sus líneas; Pagatu calcula los totales.
• Crear un documento profesional —propuesta, contrato, acuerdo, carta— eligiendo plantilla e idioma.

Nada se emite, se numera ni se envía al cliente: los documentos quedan en Pagatu para que los revises y los mandes tú. El conector no mueve dinero, no registra pagos, no emite facturas y no borra nada.

Tus datos siguen siendo tuyos: cada llamada se hace con tu propia identidad, así que solo alcanzas lo que ya ves en Pagatu. Los métodos de cobro se listan sin números de cuenta, CCI, IBAN ni alias de billetera, y los documentos se devuelven sin su enlace público.

Necesitas una cuenta de Pagatu (pagatu.io). Al conectar, iniciarás sesión con tu cuenta y autorizarás el acceso; puedes revocarlo cuando quieras.
```

**Categories** (1-5, lista desplegable del portal). Por orden de encaje:
Productivity · Finance / Accounting · Sales o CRM · Project management.
Elige las que existan en el desplegable; no inventes.

**Documentation URL** — pendiente, ver «Lo que falta».

**Privacy policy URL**

```
https://pagatu.io/privacidad
```

**Terms** (si lo pide)

```
https://pagatu.io/terminos
```

**Support contact**

```
hola@pagatu.io
```

**Icon** — el isotipo de Pagatu. El formato y el tamaño no estaban escritos en
las páginas que leí; sube un PNG cuadrado de 512×512 con fondo transparente y
corrige si el portal se queja.

**URL slug** — es permanente. Sugerencia: `pagatu`.

---

## 4. Use cases

Requisito previo del usuario: **cuenta en pagatu.io** (cualquier plan; el plan
decide los límites de documentos y clientes, no el acceso al conector).

1. **Ponerse al día.** «¿Qué facturas tengo pendientes de cobro y de quién?» —
   lectura de facturas y cobros, con el pendiente agrupado por moneda.
2. **Preparar una cotización.** «Haz una cotización para Acme por 3 horas de
   consultoría a 80 USD» — crea el borrador con sus líneas; el usuario lo
   revisa y lo envía desde Pagatu.
3. **Redactar un contrato.** «Créame un contrato en inglés con la plantilla de
   prestación de servicios para este cliente» — lista plantillas y crea el
   documento profesional en borrador.
4. **Revisar la agenda.** «¿Qué citas tengo esta semana y con quién?»

Lectura y escritura: **ambas**. La escritura se limita a crear borradores
(cliente, cotización, documento profesional) y está marcada como destructiva
para que Claude pida confirmación.

---

## 5. Company

| Campo | Valor |
| --- | --- |
| Company name | Pagatu (Adquieremas) — usa la razón social con la que facturas |
| Website | `https://pagatu.io` |
| Primary contact | `hola@pagatu.io` |

---

## 6. Authentication

| Campo | Valor |
| --- | --- |
| Tipo | OAuth 2.0 |
| Variante | `oauth_dcr` (registro dinámico de cliente, RFC 7591) |
| Authorization server | `https://clerk.pagatu.io` (Clerk) |
| Scopes | `profile`, `email`, `offline_access` |
| PKCE | S256 |
| Descubrimiento | RFC 9728 en `https://mcp.pagatu.io/.well-known/oauth-protected-resource/mcp` |

Comprobado: `/mcp` sin token responde **401** con
`WWW-Authenticate: Bearer … resource_metadata="…"`, el `resource` coincide con
la URL que escribe el usuario y Clerk publica su metadata RFC 8414.

---

## 7. Data handling

- **Origen de la API:** propia. El conector habla con el backend de Pagatu
  (Convex) con la identidad del propio usuario; no es proxy de terceros.
- **Datos de salud personales:** no.
- **Contenido patrocinado:** no.
- **Datos de conversación:** no se recoge ninguno. El servidor no guarda
  historial, no tiene base de datos propia y solo registra el identificador
  truncado del usuario, la herramienta y la duración.
- **Acceso a memoria, historial o archivos de Claude:** ninguno.

---

## 8. Test & launch

Las 16 herramientas se han probado contra una cuenta real desde Claude y desde
Codex. No hace falta dejar credenciales en el portal; si piden acceso de prueba
para optar a **Verified**, hay que preparar una cuenta de Pagatu de demostración.

---

## 9. Compliance (las siete confirmaciones)

1. **Directrices del directorio** — cumplidas.
2. **APIs propias** — sí: backend de Pagatu, mismo dominio que el servicio.
3. **Transacciones financieras** — **ninguna**. Facturas, cobros y métodos de
   cobro son de **solo lectura**; el conector no transfiere dinero ni cripto,
   no registra pagos y no emite facturas. Las funciones que harían eso existen
   en el backend y están deliberadamente fuera del conector.
4. **Generación de medios con IA** — no genera imágenes, vídeo ni audio.
5. **Prompt injection** — las descripciones describen lo que hace cada
   herramienta; no instruyen a Claude ni promocionan nada.
6. **Recogida de datos de conversación** — no se recoge.
7. **Documentación pública** — pendiente (ver abajo).

---

## Lo que falta antes de enviar

**1. URL de documentación pública.** Es obligatoria y su ausencia es motivo de
rechazo. Hoy `https://github.com/Adquieremas/pagatu-mcp` es un repositorio
**privado**, así que no sirve, y además es la URL que el servidor anuncia en
`resource_documentation`. Dos salidas:

- Hacer público el repositorio (el README ya explica qué hace, cómo conectarlo
  y qué no hace). No hay secretos versionados.
- O publicar una página en `pagatu.io` —por ejemplo `pagatu.io/mcp`— y
  apuntar ahí.

Elijas la que elijas, hay que actualizar `resource_documentation` en
`src/auth/metadata.ts` y volver a desplegar.

**2. Cloudflare y el rango de Anthropic.** Exigen que el servidor de
autorización sea alcanzable desde `160.79.104.0/21`. `clerk.pagatu.io` está
tras Cloudflare, que ya respondió con un reto de bot a clientes que no son
navegador. Si el WAF reta a sus servidores durante el descubrimiento, la
revisión falla sin que el código tenga nada malo. Conviene excluir del reto las
rutas `/.well-known/*`, `/oauth/*` y `/v1/*` de `clerk.pagatu.io`, o permitir
ese rango.

**3. Refrescar el conector antes de enviar.** El portal sincroniza las
herramientas desde el servidor en vivo; asegúrate de que tu Claude ya ve las 16
con las anotaciones nuevas.

## Después de enviar

Un escaneo automático revisa políticas y el conector se publica como
**Community**. Algunos envíos pasan además por revisión humana, sin plazo fijo.
Estados: Draft → In review → (Changes requested / Not approved) → Approved, y
entonces hay que pulsar **Publish**.

Para optar a **Verified** hace falta plan de pago y dominio probado, y un
revisor prueba cada herramienta. Contacto para dudas del envío:
`mcp-review@anthropic.com`.
