/**
 * Log mínimo y sin datos personales.
 *
 * Regla: NUNCA se escribe el token, el email, el nombre ni el contenido de un
 * documento. Lo único que identifica al usuario en el log es su `clerkId`
 * truncado, que basta para correlacionar una traza y no para reconstruir una
 * cuenta.
 */

import type { Config, LogLevel } from './env'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

/** `user_2abc…` en lugar del id completo. */
export function shortUserId(userId: string): string {
  return userId.length <= 12 ? userId : `${userId.slice(0, 12)}…`
}

export function createLogger(level: LogLevel, base: Record<string, unknown> = {}): Logger {
  const threshold = ORDER[level]
  const write = (lvl: LogLevel, message: string, data?: Record<string, unknown>) => {
    if (ORDER[lvl] < threshold) return
    const line = JSON.stringify({ level: lvl, msg: message, ...base, ...data })
    if (lvl === 'error') console.error(line)
    else if (lvl === 'warn') console.warn(line)
    // `info`/`debug` también salen por stderr: en Workers ambos llegan a
    // `wrangler tail` y así `no-console` no necesita excepciones.
    else console.warn(line)
  }
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  }
}

export function loggerFromConfig(config: Config, base?: Record<string, unknown>): Logger {
  return createLogger(config.logLevel, base)
}
