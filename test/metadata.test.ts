import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/env'
import { protectedResourceMetadata, resourceMetadataUrl, wwwAuthenticate } from '../src/auth/metadata'
import { testEnv } from './helpers'

const config = resolveConfig(testEnv())

describe('metadatos OAuth', () => {
  it('publica Clerk como authorization server y /mcp como recurso', () => {
    const metadata = protectedResourceMetadata(config)
    expect(metadata).toMatchObject({
      resource: 'https://mcp.pagatu.io/mcp',
      authorization_servers: ['https://clerk.pagatu.io'],
      bearer_methods_supported: ['header'],
    })
  })

  it('la ruta de metadatos lleva la ruta del recurso al final (RFC 9728)', () => {
    expect(resourceMetadataUrl(config)).toBe('https://mcp.pagatu.io/.well-known/oauth-protected-resource/mcp')
  })

  it('el WWW-Authenticate apunta a los metadatos y no rompe el formato con comillas', () => {
    const header = wwwAuthenticate(config, 'token "raro"')
    expect(header).toContain('resource_metadata="https://mcp.pagatu.io/.well-known/oauth-protected-resource/mcp"')
    expect(header).toContain("error_description=\"token 'raro'\"")
    expect(header.match(/"/g)?.length).toBe(8)
  })
})
