import { describe, expect, it } from 'vitest'
import { ConfigError, resolveConfig } from '../src/env'
import { testEnv } from './helpers'

describe('resolveConfig', () => {
  it('lista TODAS las variables que faltan, no solo la primera', () => {
    try {
      resolveConfig({})
      expect.unreachable('debería haber lanzado ConfigError')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).missing).toEqual([
        'CLERK_SECRET_KEY',
        'CLERK_JWT_ISSUER_DOMAIN',
        'CONVEX_URL',
        'PAGATU_MCP_PUBLIC_URL',
      ])
    }
  })

  it('normaliza las URLs quitando la barra final', () => {
    const config = resolveConfig(
      testEnv({ PAGATU_MCP_PUBLIC_URL: 'https://mcp.pagatu.io/', CONVEX_URL: 'https://x.convex.cloud/' }),
    )
    expect(config.publicUrl).toBe('https://mcp.pagatu.io')
    expect(config.convexUrl).toBe('https://x.convex.cloud')
  })

  it('la escritura viene activada salvo que se apague explícitamente', () => {
    expect(resolveConfig(testEnv()).writeEnabled).toBe(true)
    expect(resolveConfig(testEnv({ PAGATU_MCP_WRITE_ENABLED: 'false' })).writeEnabled).toBe(false)
    expect(resolveConfig(testEnv({ PAGATU_MCP_WRITE_ENABLED: '0' })).writeEnabled).toBe(false)
    // Un valor sin sentido no apaga nada por accidente.
    expect(resolveConfig(testEnv({ PAGATU_MCP_WRITE_ENABLED: 'quizás' })).writeEnabled).toBe(true)
  })

  it('usa `convex` como plantilla JWT por defecto', () => {
    expect(resolveConfig(testEnv()).convexJwtTemplate).toBe('convex')
    expect(resolveConfig(testEnv({ CLERK_CONVEX_JWT_TEMPLATE: 'convex-mcp' })).convexJwtTemplate).toBe('convex-mcp')
  })

  it('parsea la lista de clientes OAuth permitidos', () => {
    const config = resolveConfig(testEnv({ PAGATU_MCP_ALLOWED_CLIENT_IDS: ' a , b ,, c ' }))
    expect(config.allowedClientIds).toEqual(['a', 'b', 'c'])
    expect(resolveConfig(testEnv()).allowedClientIds).toEqual([])
  })
})
