import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Auth } from '../src/server/auth'

function sessionCookie(host: string, scheme: 'http' | 'https' = 'http', remote = '127.0.0.1'): string {
  const auth = new Auth({ host, appPort: 17994, controlPort: 17995, publicScheme: scheme })
  const set: string[] = []
  const res = { appendHeader: (_name: string, value: string) => { set.push(value) } } as unknown as ServerResponse
  const req = { socket: { remoteAddress: remote }, headers: {} } as IncomingMessage
  expect(auth.issuePageSession(req, res)?.access).toBe('owner')
  return set.join('\n')
}

describe('panel session cookie', () => {
  it('is partitioned on loopback so a DSH iframe keeps the WebSocket session', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']) {
      const cookie = sessionCookie(host)
      expect(cookie).toContain('Path=/__ph')
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=None')
      expect(cookie).toContain('Secure')
      expect(cookie).toContain('Partitioned')
      expect(cookie).not.toContain('SameSite=Strict')
    }
  })

  it('stays Strict without Secure on a public http bind', () => {
    for (const host of ['0.0.0.0', '192.168.1.8']) {
      const cookie = sessionCookie(host, 'http', '203.0.113.8')
      expect(cookie).toContain('SameSite=Strict')
      expect(cookie).not.toContain('Secure')
      expect(cookie).not.toContain('Partitioned')
      expect(cookie).not.toContain('SameSite=None')
    }
  })

  it('is partitioned when browsers reach the panel over https', () => {
    const cookie = sessionCookie('0.0.0.0', 'https', '203.0.113.8')
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Partitioned')
  })
})
