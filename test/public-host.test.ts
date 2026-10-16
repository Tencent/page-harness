import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { publicHostOf } from '../src/cli/index'
import { startHarness, type Harness } from '../src/server/harness'
import { freePort, staticServer, tempProject } from './helpers'

process.env.PH_FAKE_AGENT = '1'

let h: Harness
let target: Awaited<ReturnType<typeof staticServer>>
let controlPort: number

beforeAll(async () => {
  const project = tempProject()
  target = await staticServer(project)
  const appPort = await freePort()
  controlPort = await freePort()
  h = await startHarness({ target: new URL(target.url), project, host: '127.0.0.1', appPort, controlPort, noAgent: true, share: true, publicHost: 'preview.example.com' })
})

afterAll(async () => {
  await h?.close()
  await target?.close()
})

function statusWithHost(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: controlPort, path: '/__ph/join?t=wrong', headers: { Host: host } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
  })
}

describe('--public-host', () => {
  it('puts the public host into the invite link', () => {
    expect(h.shareUrl).toMatch(new RegExp(`^http://preview\\.example\\.com:${controlPort}/__ph/join\\?t=`))
  })

  it('accepts the public host as a Host header', async () => {
    expect(await statusWithHost(`preview.example.com:${controlPort}`)).toBe(403)
    expect(await statusWithHost(`other.example.com:${controlPort}`)).toBe(421)
  })

  it('validates the flag', () => {
    expect(publicHostOf(undefined)).toBeUndefined()
    expect(publicHostOf(' Preview.Example.com ')).toBe('preview.example.com')
    expect(() => publicHostOf('https://x.com')).toThrow()
    expect(() => publicHostOf('x.com:8080')).toThrow()
    expect(publicHostOf('2001:DB8::1')).toBe('[2001:db8::1]')
    expect(publicHostOf('[::1]')).toBe('[::1]')
  })

  it('puts an IPv6 public host in the invite link and the Host allow-list', async () => {
    const project = tempProject()
    const upstream = await staticServer(project)
    const appPort = await freePort()
    const port = await freePort()
    const ipv6 = await startHarness({ target: new URL(upstream.url), project, host: '127.0.0.1', appPort, controlPort: port, noAgent: true, share: true, publicHost: '[2001:db8::1]' })
    try {
      expect(ipv6.shareUrl).toMatch(new RegExp(`^http://\\[2001:db8::1\\]:${port}/__ph/join\\?t=`))
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/__ph/join?t=wrong', headers: { Host: `[2001:db8::1]:${port}` } }, (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        })
        req.on('error', reject)
      })
      expect(status).toBe(403)
    } finally {
      await ipv6.close()
      await upstream.close()
    }
  })
})
