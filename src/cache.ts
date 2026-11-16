/**
 * Caché en memoria con caducidad, por isolate del Worker.
 *
 * Sirve para no pedirle a Clerk lo mismo dos veces en la misma ráfaga de
 * llamadas (un cliente MCP suele encadenar varias herramientas seguidas). No
 * es un almacén: si el isolate se recicla, se vuelve a preguntar. Nada que
 * dependa de que esto persista debe escribirse aquí.
 */

interface Entry<T> {
  value: T
  expiresAt: number
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>()
  private readonly maxEntries: number

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries
  }

  get(key: string, now = Date.now()): T | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (hit.expiresAt <= now) {
      this.store.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key: string, value: T, ttlMs: number, now = Date.now()): void {
    if (ttlMs <= 0) return
    // Tope duro: un isolate no debe crecer sin límite por muchos usuarios que
    // pasen por él. Se tira la entrada más antigua insertada (orden del Map).
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next()
      if (!oldest.done) this.store.delete(oldest.value)
    }
    this.store.set(key, { value, expiresAt: now + ttlMs })
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }
}

/**
 * Clave de caché derivada de un secreto.
 *
 * Los tokens no se usan como clave en claro ni aquí dentro: se guarda su
 * SHA-256. Cuesta microsegundos y evita que un volcado de memoria o un log
 * accidental de las claves exponga credenciales vivas.
 */
export async function hashKey(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
