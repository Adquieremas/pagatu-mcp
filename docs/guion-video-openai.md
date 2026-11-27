# Guion del vídeo de revisión para el directorio de apps de OpenAI

Es el último requisito bloqueante del envío: **Review information → Supporting
content → Video walkthrough URL**. El portal pide una grabación que demuestre
«los casos de prueba y la funcionalidad del plugin». No se publica: la ven solo
los revisores.

Duración objetivo: **4–6 minutos**. Pantalla completa de ChatGPT, sin recortes
raros. Si narras en español, pon **subtítulos o rótulos en inglés**: quien lo
revisa probablemente no habla español y lo que no entienda, lo marca.

---

## Antes de grabar

- [ ] Entra con la **cuenta de demostración**, no con la tuya: en el vídeo se
      verán nombres de clientes e importes.
- [ ] Siembra esa cuenta con datos creíbles y sin PII real: 4–6 clientes
      (alguno empresa, alguno persona), 3–4 documentos en estados distintos,
      2 facturas (una cobrada, una parcial o vencida) y 2–3 citas futuras.
- [ ] Deja el conector **ya conectado** salvo en la escena 1, donde se conecta
      a propósito.
- [ ] Cierra notificaciones, correo y cualquier pestaña con datos personales.
- [ ] Ten a mano los nombres exactos que vas a decir («Acme», el nombre de la
      plantilla de contrato) para no dudar en cámara.

---

## Escena 1 · Qué es y cómo se conecta (0:00 – 0:50)

**Haz:** desde ChatGPT, añade el conector Pagatu y completa el inicio de sesión
hasta la pantalla de consentimiento; concede el acceso.

**Di:**

> Pagatu es donde los freelancers de Perú y Latinoamérica llevan sus clientes,
> sus documentos comerciales, su agenda y sus cobros. Este conector trabaja con
> esa misma cuenta desde ChatGPT. Para conectarlo inicias sesión con tu propia
> cuenta de Pagatu y autorizas el acceso: cada llamada se hace con tu
> identidad, así que solo alcanzas lo que ya ves en Pagatu.

**Enseña** la pantalla de consentimiento el tiempo suficiente para que se lea.

---

## Escena 2 · Quién soy (0:50 – 1:15)

**Escribe:** `¿Con qué cuenta de Pagatu estás trabajando?`

**Enseña:** la respuesta de `pagatu_whoami` con el nombre del negocio y el plan,
y la lista corta de lo que el conector sabe hacer (viene de la skill de
bienvenida).

> Esto es la skill de incorporación: lo primero que hace es decir con qué
> cuenta trabaja y avisar de que todo lo que se cree nace en borrador.

---

## Escena 3 · Caso positivo 1 · Facturas pendientes (1:15 – 2:00)

**Escribe, literal del caso de prueba:**

> ¿Qué facturas tengo pendientes de cobro y de qué clientes?

**Enseña:** la llamada a `pagatu_list_invoices` y la respuesta con el estado
efectivo de cada factura, lo cobrado y el saldo.

**Di:**

> Lectura pura. Cada factura sale con su estado —emitida, parcial, pagada o
> vencida—, lo cobrado y el saldo, y el pendiente se agrupa por moneda, sin
> sumar soles con dólares. No se cobra nada ni se registra ningún pago.

---

## Escena 4 · Caso positivo 2 · Cobros (2:00 – 2:25)

**Escribe:** `¿Cuánto me deben en total y quién me ha pagado este mes?`

**Enseña:** `pagatu_list_payments`, con el pendiente por moneda.

Puedes encadenarlo con la escena anterior y narrar solo la diferencia: aquí se
ve el dinero recibido, allí el documento que lo origina.

---

## Escena 5 · Caso positivo 3 · Buscar clientes (2:25 – 2:50)

**Escribe:** `Busca en mis clientes a los que sean empresas de Perú`

**Enseña:** `pagatu_list_clients` devolviendo las fichas que coinciden.

**Di:**

> El filtro se aplica sobre lo que Pagatu ya devolvió para esta cuenta. No hay
> ningún identificador interno en la respuesta, y los documentos que aparecen
> son la identificación tributaria que va impresa en la factura, no documentos
> de identidad.

Esa frase responde al aviso del escaneo automático: dila aunque te parezca
obvia.

---

## Escena 6 · Caso positivo 4 · Crear una cotización (2:50 – 3:50)

**Escribe:**

> Crea una cotización para Acme por 3 horas de consultoría a 80 USD la hora

**Enseña, sin saltarte nada:**

1. ChatGPT **pidiendo confirmación** antes de escribir.
2. Tu confirmación.
3. La llamada a `pagatu_create_quote` y el enlace devuelto.
4. **Abre ese enlace en Pagatu** y muestra el documento: en estado **borrador**,
   con sus líneas y el total calculado por Pagatu, sin número de serie.

**Di:**

> Es la primera de las tres herramientas de escritura, y está marcada como
> destructiva para que el asistente pida permiso. Nace en borrador: no se
> emite, no consume numeración y no se le envía nada al cliente. Eso lo hace la
> persona desde Pagatu.

Esta escena es la que más mira un revisor. No la aceleres.

---

## Escena 7 · Caso positivo 5 · Documento profesional (3:50 – 4:40)

**Escribe:**

> Crea un contrato en español con la plantilla de prestación de servicios para
> el cliente Acme

**Enseña:** `pagatu_list_document_templates` listando las plantillas, la
elección de una, la confirmación, `pagatu_create_document` y el enlace al
editor con el contrato en borrador.

---

## Escena 8 · Los tres casos negativos (4:40 – 5:40)

Uno detrás de otro, enseñando la **negativa** en cada uno. No hace falta
narrar los tres: basta con leer en voz alta el límite que demuestra cada uno.

| Escribe | Lo que se tiene que ver |
| --- | --- |
| `Paga la factura INV-2026-0002 desde mi cuenta bancaria y márcala como cobrada` | El conector no mueve dinero ni registra pagos; no hay herramienta para eso |
| `Emite la cotización COT-2026-0003 y mándasela ya al cliente por correo` | No emite ni envía: eso se hace desde Pagatu |
| `Borra todos mis clientes inactivos y vacía la papelera de documentos` | No borra nada; las 13 herramientas de lectura solo leen |

**Di al cierre de esta escena:**

> Las tres cosas que la gente teme que haga un conector conectado a su
> facturación —mover dinero, emitir a nombre del usuario y borrar— son
> exactamente las tres que no están.

---

## Escena 9 · Cierre (5:40 – 6:00)

> Dieciséis herramientas: trece de lectura y tres que crean borradores. Nada se
> emite, nada se envía y no se mueve dinero. Los métodos de cobro se listan sin
> números de cuenta, CCI, IBAN ni alias de billetera, y los documentos se
> devuelven sin su enlace público.

---

## Después de grabar

1. Súbelo **sin listar** a YouTube, o a Loom con enlace para cualquiera que lo
   tenga. Que no pida iniciar sesión: un revisor que no puede abrirlo es un
   rechazo.
2. Ábrelo tú en una ventana de incógnito para comprobarlo.
3. Pega la URL en **Review information → Supporting content → Video walkthrough
   URL** y pulsa **Save details**.
4. Rellena **Reviewer credentials** —la vía del *magic link* a
   `mcp-review@theaicompany.org` evita entregar una contraseña— y pulsa
   **Submit for review**.
