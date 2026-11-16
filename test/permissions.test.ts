import { describe, expect, it } from 'vitest'
import { assertToolAllowed, missingScopes } from '../src/auth/permissions'
import { ForbiddenError } from '../src/errors'

describe('assertToolAllowed', () => {
  it('deja pasar una lectura sin scopes exigidos', () => {
    expect(() =>
      assertToolAllowed({ name: 'pagatu_list_clients', permission: 'read' }, { scopes: [], writeEnabled: false }),
    ).not.toThrow()
  })

  it('bloquea la escritura cuando el servidor es de solo lectura', () => {
    expect(() =>
      assertToolAllowed({ name: 'pagatu_create_client', permission: 'write' }, { scopes: [], writeEnabled: false }),
    ).toThrowError(ForbiddenError)
  })

  it('permite la escritura cuando está habilitada', () => {
    expect(() =>
      assertToolAllowed({ name: 'pagatu_create_client', permission: 'write' }, { scopes: [], writeEnabled: true }),
    ).not.toThrow()
  })

  it('exige los scopes declarados por la herramienta', () => {
    const policy = { name: 'x', permission: 'write' as const, requiredScopes: ['profile', 'email'] }
    expect(missingScopes(policy, ['profile'])).toEqual(['email'])
    expect(() => assertToolAllowed(policy, { scopes: ['profile'], writeEnabled: true })).toThrowError(/email/)
    expect(() => assertToolAllowed(policy, { scopes: ['profile', 'email'], writeEnabled: true })).not.toThrow()
  })
})
