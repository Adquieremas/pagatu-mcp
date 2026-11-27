# Envío al directorio de apps de OpenAI

Enviado el **27/11/2026**. Estado en `platform.openai.com/plugins`:
**Pagatu · Version 1.0.0 · In review**.

Organización **Adquieretech**, plugin
`plugin_asdk_app_6b09d678440c8191ae811c29ec537a5c`.

---

## Lo que se envió

| Pieza | Dónde vive |
| --- | --- |
| Paquete | `openai-plugin/` (plugin.json, mcp.json, skills/, assets/icon.png) |
| Servidor MCP | `https://mcp.pagatu.io/mcp` |
| Vídeo de recorrido | `https://www.youtube.com/watch?v=7Gnf_uA1j0U` |
| Guion del vídeo | `docs/guion-video-openai.md` |
| Cuenta del revisor | cuenta de demostración en `app.pagatu.io`, con datos inventados |

El ZIP se arma comprimiendo el contenido de `openai-plugin/` (no la carpeta).
Los campos que vienen del ZIP son de solo lectura en el portal: para cambiarlos
hay que subir una versión nueva.

Verificaciones hechas: identidad del desarrollador, dominio
(`/.well-known/openai-apps-challenge`, token en `wrangler.jsonc`) y conexión
OAuth con las 16 herramientas descubiertas.

---

## Los dos avisos del escaneo

El escáner marcó `pagatu_list_clients` y `pagatu_create_client`:

> This tool appears to solicit a government-issued identifier, such as an SSN,
> passport number, or driver's license number.

**No son bloqueantes** (con el filtro «Blocking» la lista queda vacía), y la
guía del portal lo confirma: «Other findings can be submitted for human review
and do not mean automatic rejection».

Qué se hizo:

1. Se reescribieron las descripciones (commit `6ef6d43`). `documentType` y
   `documentNumber` son la identificación TRIBUTARIA que va impresa en la
   factura —RUC, NIT, CUIT, RFC—, no un documento de identidad. El aviso sigue
   saliendo con el texto nuevo: el escáner marca cualquier identificador fiscal.
2. Se explicó en «Additional Submission Context», que es privado para los
   revisores: qué son esos campos, que facturas y cobros son de solo lectura, y
   que las tres herramientas de escritura solo crean borradores.

No se quitaron los campos: sin RUC no se puede facturar en Perú.

---

## Dos cosas que descubrimos por las malas

**1. Un complemento cargado por ZIP solo funciona en la aplicación de
escritorio de ChatGPT.** En `chatgpt.com` no aparece en el selector de
complementos, y el modelo, al no tener la herramienta, se pone a navegar la web
de Pagatu y responde cosas que parecen errores del conector pero no lo son.
Además hay dos autorizaciones distintas que es fácil confundir: la del portal
de desarrollador (`Connect` en la pestaña MCPs) y la del usuario final dentro
de su ChatGPT. Una no implica la otra.

**2. Clerk pedía `openid` y la instancia no lo permitía.** El `Connect` del
portal fallaba con `error=invalid_scope`. Se arregla en el dashboard de Clerk:
OAuth applications → Scopes → *Allowed scopes for dynamic clients* → añadir
`openid` (quedan cuatro: email, profile, openid, offline_access).

---

## Qué queda por hacer

- Esperar la revisión. No hay plazo fijo. Si piden cambios, se sube una versión
  nueva del ZIP y se vuelve a enviar.
- Cuando termine: cambiar la contraseña de la cuenta de demostración.
- El método de cobro de la cuenta de demostración está sin configurar; si un
  revisor prueba `pagatu_list_payment_methods` verá una lista vacía.
