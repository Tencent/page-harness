import { existsSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { embedOriginsOf } from '../src/cli/index'
import { clientDir } from '../src/server/app'
import { Auth, embedNext } from '../src/server/auth'
import { injectHtml, relaxCsp } from '../src/server/inject'
import { startHarness, type Harness } from '../src/server/harness'
import { freePort, staticServer, tempProject } from './helpers'

const built = existsSync(path.join(clientDir(), 'app', 'panel.html'))
const EMBED = 'http://localhost:3080'

let h: Harness
let target: Awaited<ReturnType<typeof staticServer>>
let appPort: number
let controlPort: number

beforeAll(async () => {
  const project = tempProject()
  target = await staticServer(project, { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" })
  appPort = await freePort()
  controlPort = await freePort()
  h = await startHarness({ target: new URL(target.url), project, host: '127.0.0.1', appPort, controlPort, noAgent: true, embedOrigins: [EMBED] })
})

afterAll(async () => {
  await h?.close()
  await target?.close()
})

describe('--embed-origin', () => {
  it('lets the embedder frame the proxied page', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/`)
    expect(res.headers.get('x-frame-options')).toBeNull()
    expect(res.headers.get('content-security-policy')).toBe(`frame-ancestors 'self' ${EMBED}`)
  })

  it.skipIf(!built)('tells the overlay which parents may receive quotes', async () => {
    const js = await (await fetch(`http://127.0.0.1:${appPort}/__ph/overlay.js`)).text()
    expect(js).toContain(`"embed":["${EMBED}"]`)
  })

  it.skipIf(!built)('lets the panel iframe load inside the embedder', async () => {
    const res = await fetch(`http://127.0.0.1:${controlPort}/__ph/ui`)
    expect(res.headers.get('content-security-policy')).toContain(`frame-ancestors http://127.0.0.1:${appPort} ${EMBED}`)
  })

  it('validates the flag', () => {
    expect(embedOriginsOf(undefined)).toBeUndefined()
    expect(embedOriginsOf(['http://localhost:3080/'])).toEqual([EMBED])
    expect(() => embedOriginsOf(['http://localhost:3080/x'])).toThrow()
    expect(() => embedOriginsOf(['localhost:3080'])).toThrow()
    expect(relaxCsp("frame-ancestors 'none'", 'http://c', [EMBED]).csp).toBe(`frame-ancestors 'self' ${EMBED}`)
    expect(relaxCsp("frame-ancestors https://other.example", 'http://c', [EMBED]).csp).toBe(`frame-ancestors 'self' ${EMBED}`)
    const meta = injectHtml(`<head><meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'"></head>`, { controlOrigin: 'http://c', embedOrigins: [EMBED] })
    expect(meta).toContain(`frame-ancestors 'self' ${EMBED}`)
    expect(embedNext('/a?x=1#h')).toBe('/a?x=1#h')
    expect(embedNext('//evil.example')).toBeNull()
    expect(embedNext('https://evil.example/a')).toBeNull()
    const auth = new Auth({ host: '0.0.0.0', appPort: 1, controlPort: 2, embedToken: 'secret' })
    const remote = { socket: { remoteAddress: '203.0.113.8' }, headers: {} } as IncomingMessage
    const local = { socket: { remoteAddress: '127.0.0.1' }, headers: {} } as IncomingMessage
    expect(auth.allowApp(remote)).toBe(false)
    expect(auth.allowApp(local)).toBe(true)
    expect(auth.issuePageSession(remote, { appendHeader() {} } as never)).toBeNull()
  })
})

describe('--embed-origin without an upstream frame policy', () => {
  let hx: Harness
  let upstream: Awaited<ReturnType<typeof staticServer>>
  let app: number

  beforeAll(async () => {
    const project = tempProject(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'"></head><body>x</body></html>`)
    upstream = await staticServer(project, { 'X-Frame-Options': 'DENY' })
    app = await freePort()
    const control = await freePort()
    hx = await startHarness({ target: new URL(upstream.url), project, host: '0.0.0.0', appPort: app, controlPort: control, noAgent: true, embedOrigins: [EMBED], publicHost: '127.0.0.1' })
  })

  afterAll(async () => {
    await hx?.close()
    await upstream?.close()
  })

  it('adds frame-ancestors and drops X-Frame-Options', async () => {
    const res = await fetch(`http://127.0.0.1:${app}/`)
    expect(res.headers.get('x-frame-options')).toBeNull()
    expect(res.headers.get('content-security-policy')).toBe(`frame-ancestors 'self' ${EMBED}`)
    expect(await res.text()).toContain(`frame-ancestors 'self' ${EMBED}`)
  })

  it('exchanges the embed token for a cookie and rejects other redirects', async () => {
    const token = hx.embedToken ?? ''
    expect(token).not.toBe('')
    const bad = await fetch(`http://127.0.0.1:${app}/__ph/embed?t=nope&next=/`, { redirect: 'manual' })
    expect(bad.status).toBe(403)
    const open = await fetch(`http://127.0.0.1:${app}/__ph/embed?t=${token}&next=//evil.example`, { redirect: 'manual' })
    expect(open.status).toBe(403)
    const ok = await fetch(`http://127.0.0.1:${app}/__ph/embed?t=${encodeURIComponent(token)}&next=${encodeURIComponent('/index.html?x=1')}`, { redirect: 'manual' })
    expect(ok.status).toBe(302)
    expect(ok.headers.get('location')).toBe('/index.html?x=1')
    expect(ok.headers.get('set-cookie')).toContain('__ph_embed_')
  })
})
