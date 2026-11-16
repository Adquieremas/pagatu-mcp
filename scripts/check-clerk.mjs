#!/usr/bin/env node
/**
 * Comprueba, contra el Clerk REAL, las tres cosas de las que depende este MCP:
 *
 *   1. que el endpoint de verificación de tokens OAuth responde,
 *   2. que existe el JWT template de Convex,
 *   3. que se puede firmar ese token desde una sesión activa de un usuario.
 *
 * Lee las variables de `.dev.vars` (o del entorno, si están puestas). No
 * imprime la clave secreta ni el JWT: solo el veredicto y las claims que
 * importan (`iss`, `aud`, vida del token).
 *
 *   node scripts/check-clerk.mjs
 *   CLERK_SECRET_KEY=sk_live_… node scripts/check-clerk.mjs   (producción)
 */

import { readFileSync } from 'node:fs'

function loadDevVars(file = '.dev.vars') {
  try {
    const out = {}
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

const file = loadDevVars()
const secret = process.env.CLERK_SECRET_KEY ?? file.CLERK_SECRET_KEY
const template = process.env.CLERK_CONVEX_JWT_TEMPLATE ?? file.CLERK_CONVEX_JWT_TEMPLATE ?? 'convex'
const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN ?? file.CLERK_JWT_ISSUER_DOMAIN
const apiUrl = (process.env.CLERK_API_URL ?? file.CLERK_API_URL ?? 'https://api.clerk.com').replace(/\/+$/, '')

if (!secret) {
  console.error('Falta CLERK_SECRET_KEY: ponla en .dev.vars o en el entorno.')
  process.exit(1)
}

const entorno = secret.startsWith('sk_live_') ? 'PRODUCCIÓN' : 'desarrollo'
console.log(`Instance de Clerk: ${entorno}${issuer ? ` (${issuer})` : ''}`)
console.log(`JWT template esperado: ${template}\n`)

const call = async (path, init = {}) =>
  await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...init.headers },
  })

const rows = (payload) => (Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [])
let fallos = 0

// 1. Endpoint de verificación de tokens OAuth.
{
  const response = await call('/v1/oauth_applications/access_tokens/verify', {
    method: 'POST',
    body: JSON.stringify({ access_token: 'oat_token_de_prueba_invalido' }),
  })
  const payload = await response.json().catch(() => ({}))
  const esTokenInexistente = rows(payload.errors).some((error) => String(error?.code).includes('oauth_access_token'))
  // Un token inventado DEBE ser rechazado: 404 `oauth_access_token_not_found`
  // (lo que responde Clerk hoy), 401 o 400. Cualquier otra cosa es un problema
  // de permisos de la clave o de ruta.
  if (esTokenInexistente || [400, 401, 403].includes(response.status)) {
    console.log(`✓ verificación de tokens OAuth operativa (HTTP ${response.status} para un token inválido)`)
  } else {
    fallos += 1
    console.log(`✗ verificación de tokens OAuth: HTTP ${response.status} — ${JSON.stringify(payload).slice(0, 200)}`)
  }
}

// 2. El JWT template que entiende Convex.
{
  const response = await call('/v1/jwt_templates')
  const nombres = rows(await response.json().catch(() => [])).map((item) => item?.name)
  if (nombres.includes(template)) {
    console.log(`✓ JWT template «${template}» existe (plantillas: ${nombres.join(', ')})`)
  } else {
    fallos += 1
    console.log(`✗ JWT template «${template}» NO existe. Plantillas en este instance: ${nombres.join(', ') || 'ninguna'}`)
  }
}

// 3. Firmar el token de Convex desde una sesión activa.
{
  const usuarios = rows(await (await call('/v1/users?limit=10&order_by=-last_active_at')).json().catch(() => []))
  let firmado = false
  let conSesion = 0

  for (const usuario of usuarios) {
    const sesiones = rows(
      await (await call(`/v1/sessions?user_id=${encodeURIComponent(usuario.id)}&status=active&limit=5`))
        .json()
        .catch(() => []),
    )
    if (sesiones.length === 0) continue
    conSesion += 1

    const response = await call(`/v1/sessions/${encodeURIComponent(sesiones[0].id)}/tokens/${encodeURIComponent(template)}`, {
      method: 'POST',
      body: '{}',
    })
    const payload = await response.json().catch(() => ({}))
    const jwt = payload.jwt ?? payload.token
    if (!jwt) {
      fallos += 1
      console.log(`✗ no se pudo firmar el token: HTTP ${response.status} — ${JSON.stringify(payload).slice(0, 200)}`)
      break
    }

    const parte = jwt.split('.')[1]
    const claims = JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'))
    console.log('✓ token de Convex firmado desde una sesión activa')
    console.log(`    iss: ${claims.iss}`)
    console.log(`    aud: ${claims.aud ?? '(sin aud)'}`)
    console.log(`    vida: ${(claims.exp ?? 0) - (claims.iat ?? 0)} s`)
    if (issuer && claims.iss !== issuer) {
      fallos += 1
      console.log(`✗ el iss del token no coincide con CLERK_JWT_ISSUER_DOMAIN (${issuer})`)
    }
    if (claims.aud !== undefined && claims.aud !== 'convex') {
      console.log("  ⚠ Convex espera applicationID 'convex' en auth.config.ts; revisa el aud de la plantilla.")
    }
    firmado = true
    break
  }

  if (!firmado && conSesion === 0) {
    console.log(
      `⚠ ningún usuario (${usuarios.length} revisados) tiene sesión activa, así que no se pudo firmar el token.\n` +
        '  Inicia sesión en la app de Pagatu con una cuenta de este instance y vuelve a ejecutar.',
    )
  }
}

console.log(fallos === 0 ? '\nSin fallos.' : `\n${fallos} comprobación(es) fallida(s).`)
process.exit(fallos === 0 ? 0 : 1)
