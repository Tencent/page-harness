import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { bookmarkletHref, HOME_CSS, HOME_JS, homeFontFile, homeHtml, packageVersion } from '../src/server/homePage'
import { parseLang } from '../src/shared/lang'
import { startHarness, type Harness } from '../src/server/harness'
import { ReviewStore } from '../src/server/review'
import { normalizeHost } from '../src/shared/paths'
import { reviewPrompt } from '../src/shared/review-read'
import type { ReviewItem } from '../src/shared/protocol'
import { freePort, staticServer, tempProject } from './helpers'

process.env.PH_FAKE_AGENT = '1'

const human = { id: 'u', name: 'Ada', kind: 'human' as const }

describe('normalizeHost', () => {
  it('keeps hostname and a non-default port, and rejects anything that is not a host', () => {
    expect(normalizeHost('Shop.Example.com')).toBe('shop.example.com')
    expect(normalizeHost('https://Shop.Example.com/docs')).toBe('shop.example.com')
    expect(normalizeHost('http://127.0.0.1:5179/')).toBe('127.0.0.1:5179')
    expect(normalizeHost('localhost:5173')).toBe('localhost:5173')
    expect(normalizeHost('user:pass@shop.example.com')).toBe('')
    expect(normalizeHost('javascript:alert(1)')).toBe('')
    expect(normalizeHost('')).toBe('')
    expect(normalizeHost('not a host')).toBe('')
  })
})

describe('review store by site', () => {
  it('groups notes by host, clears one site, and backfills old files with the proxied host', () => {
    const dir = path.join(tempProject(), '.page-harness')
    const s = new ReviewStore(dir, 'docs.example.com')
    const a = s.add({ kind: 'note', selector: 'h1', note: 'Docs headline', path: '/', host: 'https://Docs.Example.com/guide' })
    const b = s.add({ kind: 'note', selector: 'h1', note: 'Shop headline', path: '/', host: 'shop.example.com' })
    const c = s.add({ kind: 'note', selector: 'p', note: 'Falls back to the target', path: '/' })
    expect(a.host).toBe('docs.example.com')
    expect(b.host).toBe('shop.example.com')
    expect(c.host).toBe('docs.example.com')
    expect(s.sites()).toEqual([
      { host: 'docs.example.com', total: 2, open: 2 },
      { host: 'shop.example.com', total: 1, open: 1 },
    ])
    expect(s.forHost('docs.example.com').items.map((i) => i.id)).toEqual([a.id, c.id])
    expect(s.page({ scope: 'all', path: '/', page: 1, pageSize: 20 }).total).toBe(3)
    expect(s.page({ scope: 'all', path: '/', page: 1, pageSize: 20, host: 'shop.example.com' }).items.map((i) => i.say)).toEqual(['Shop headline'])
    expect(s.page({ scope: 'all', path: '/', page: 1, pageSize: 20, host: '' }).total).toBe(0)
    s.approve('/', human, 'approved', 'shop.example.com')
    expect(s.clear('shop.example.com')).toBe(1)
    expect(s.forHost('shop.example.com')).toEqual({ items: [], approvals: [] })
    expect(s.list()).toHaveLength(2)

    const old = path.join(tempProject(), '.page-harness')
    mkdirSync(old, { recursive: true })
    writeFileSync(
      path.join(old, 'review.json'),
      JSON.stringify([{ id: 'rv_1', n: 1, kind: 'note', path: '/', selector: 'h1', note: 'old', createdAt: 1 }]),
    )
    const migrated = new ReviewStore(old, 'http://127.0.0.1:5179')
    expect(migrated.list()[0].host).toBe('127.0.0.1:5179')
    expect(JSON.parse(readFileSync(path.join(old, 'review.json'), 'utf8')).items[0].host).toBe('127.0.0.1:5179')
  })
})

describe('bookmarklet href', () => {
  it('loads an http(s) overlay and carries the control token', () => {
    const href = bookmarkletHref('http://127.0.0.1:17991/__ph/overlay.js', { controlOrigin: 'http://127.0.0.1:17991', token: 'tok<en' })
    expect(href.startsWith('javascript:')).toBe(true)
    expect(href).toContain('http://127.0.0.1:17991/__ph/overlay.js')
    expect(href).toContain('bookmarklet')
    expect(href).toContain('\\u003cen')
    expect(href).not.toContain('<en')
    expect(href).not.toContain('"target"')
    expect(href).not.toContain('jsdelivr')
    const zhHref = bookmarkletHref('http://127.0.0.1:17991/__ph/overlay.js', { controlOrigin: 'http://127.0.0.1:17991', token: 't', lang: 'zh-CN' })
    expect(zhHref).toContain('"lang":"zh-CN"')
    expect(parseLang(undefined)).toBeUndefined()
    expect(parseLang('')).toBeUndefined()
    expect(parseLang('en')).toBe('en')
    expect(parseLang('EN-US')).toBe('en')
    expect(parseLang('zh')).toBe('zh-CN')
    expect(parseLang('zh-CN')).toBe('zh-CN')
    expect(() => parseLang('fr')).toThrow(/zh or en/)
    const zhHome = homeHtml({ token: 'tok', version: '0.1.3', lang: 'zh-CN' })
    expect(zhHome).toContain('拖到书签栏，就能用')
    expect(zhHome).toContain('在任何网页上点一下，就能直接标记。')
    expect(zhHome).toContain('我的标记 (0)')
    expect(zhHome).toContain('遇到问题？')
    expect(zhHome).toContain('点了书签没反应？')
    expect(zhHome).toContain('有的网站设了 CSP，会禁止页面连本机。')
    expect(zhHome).toContain('书签只在这次启动期间有效，重新启动后要再拖一次。')
    expect(zhHome).toContain('page-harness &lt;url&gt; --no-agent')
    expect(zhHome).toContain('✦ Page-Harness')
    expect(zhHome).not.toContain('PH 评审')
    expect(zhHome).not.toContain('data-testid="note"')
    expect(zhHome).toContain('"lang":"zh-CN"')
    const enHome = homeHtml({ token: 'tok', version: '0.1.3' })
    expect(enHome).toContain('Drag to your bookmarks bar')
    expect(enHome).toContain('Click it on any page to start marking.')
    expect(enHome).toContain('My notes (0)')
    expect(enHome).toContain('Having trouble?')
    expect(enHome).toContain('Bookmark did nothing?')
    expect(HOME_JS).toContain("location.hash === '#notes'")
    expect(HOME_JS).toContain("bar.classList.add('hot')")
    expect(HOME_JS).toContain('← 首页')
    expect(HOME_JS).toContain('← Home')
    expect(zhHome).not.toContain('bookmarklet-source')
    expect(zhHome).not.toContain('jsDelivr')
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/)
    expect(HOME_CSS).toContain('--accent: #7b61ff')
    expect(HOME_CSS).toContain('Inter Variable')
    expect(homeFontFile('inter-latin.woff2')).toBeTruthy()
    expect(homeFontFile('../package.json')).toBeNull()
    expect(() => bookmarkletHref('javascript:alert(1)', { controlOrigin: 'http://127.0.0.1:1', token: 't' })).toThrow(/http/)
  })

  it('serves home page script that parses', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'ph-home-')), 'home.js')
    writeFileSync(file, HOME_JS)
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    expect(checked.status, checked.stderr).toBe(0)
  })
})

describe('review prompt host', () => {
  it('points the agent at this control server and this site only', () => {
    const items: ReviewItem[] = [
      { id: 'a', n: 1, host: 'docs.example.com', kind: 'note', path: '/', selector: 'h1', note: 'secret docs note', author: human, status: 'open', replies: [], createdAt: 1 },
      { id: 'b', n: 2, host: 'shop.example.com', kind: 'note', path: '/', selector: 'h1', note: 'secret shop note', author: human, status: 'open', replies: [], createdAt: 1 },
    ]
    const out = reviewPrompt(items, {
      site: 'https://docs.example.com',
      path: '/',
      url: 'https://docs.example.com/',
      scope: 'all',
      lang: 'en',
      host: 'docs.example.com',
      apiBase: 'http://127.0.0.1:17991',
    })
    expect(out).toContain('host=docs.example.com')
    expect(out).toContain('GET http://127.0.0.1:17991/__ph/api/review?')
    expect(out).toContain('Site: docs.example.com')
    expect(out).toContain('Open items: 1')
    expect(out).not.toContain('secret docs note')
    expect(out).not.toContain('secret shop note')
    expect(out).not.toContain('docs.example.com:17991')
  })
})

describe('bookmarklet server', () => {
  let h: Harness
  let control: string
  const shop = 'https://shop.example.com'
  const docs = 'https://docs.example.com'

  afterAll(async () => {
    await h?.close()
  })

  it('starts review-only with no proxy, and notes stay on the site that wrote them', async () => {
    const project = tempProject()
    const controlPort = await freePort()
    h = await startHarness({ project, host: '127.0.0.1', controlPort })
    control = `http://127.0.0.1:${controlPort}`
    expect(h.bookmarklet).toBe(true)
    expect(h.noAgent).toBe(true)
    expect(h.mode).toBe('review')
    expect(h.agents).toEqual([])
    expect(h.appUrl).toBe(h.controlUrl)
    await expect(startHarness({ project, host: '127.0.0.1', controlPort: await freePort(), share: true })).rejects.toThrow(/share/)

    const home = await fetch(`${control}/`)
    expect(home.status).toBe(200)
    const html = await home.text()
    expect(html).not.toContain('bookmarklet-source')
    expect(html).toContain('Click it on any page to start marking.')
    expect(html).toContain('Drag to your bookmarks bar')
    expect(html).toContain('✦ Page-Harness')
    expect(html).toContain('data-testid="copy-prompt"')
    expect(html).not.toContain('Click it on an http page')
    expect(html).not.toContain('PH Review')
    expect(html).toContain(h.bookmarkletToken)
    expect(html).not.toContain(h.resolveToken)
    expect(html).toContain(packageVersion())
    const homeJs = await (await fetch(`${control}/__ph/home.js`)).text()
    expect(homeJs).toContain("/__ph/overlay.js")
    expect(homeJs).not.toContain('cdn.jsdelivr.net')

    const pre = await fetch(`${control}/__ph/api/review/op`, { method: 'OPTIONS', headers: { Origin: shop, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-ph-token' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe(shop)
    expect(pre.headers.get('access-control-allow-private-network')).toBe('true')

    const draft = { kind: 'note', selector: 'h1', note: 'Price is easy to miss', url: `${shop}/`, host: 'shop.example.com', severity: 'issue' }
    const denied = await fetch(`${control}/__ph/api/review/op`, {
      method: 'POST',
      headers: { Origin: shop, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'add', host: 'shop.example.com', draft }),
    })
    expect(denied.status).toBe(403)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()

    const saved = await fetch(`${control}/__ph/api/review/op`, {
      method: 'POST',
      headers: { Origin: shop, 'Content-Type': 'application/json', 'X-PH-Token': h.bookmarkletToken },
      body: JSON.stringify({ op: 'add', host: 'shop.example.com', draft }),
    })
    expect(saved.status).toBe(200)
    expect(saved.headers.get('access-control-allow-origin')).toBe(shop)
    const savedBody = (await saved.json()) as { review: { items: ReviewItem[] } }
    expect(savedBody.review.items).toHaveLength(1)
    expect(savedBody.review.items[0]).toMatchObject({ host: 'shop.example.com', note: 'Price is easy to miss' })

    await fetch(`${control}/__ph/api/review/op`, {
      method: 'POST',
      headers: { Origin: docs, 'Content-Type': 'application/json', 'X-PH-Token': h.bookmarkletToken },
      body: JSON.stringify({ op: 'add', host: 'docs.example.com', draft: { ...draft, note: 'Docs typo', url: `${docs}/`, host: 'docs.example.com' } }),
    })

    const shopState = await fetch(`${control}/__ph/api/review/state?host=shop.example.com`, { headers: { Origin: shop, 'X-PH-Token': h.bookmarkletToken } })
    expect(((await shopState.json()) as { review: { items: ReviewItem[] } }).review.items.map((i) => i.note)).toEqual(['Price is easy to miss'])
    const naked = await fetch(`${control}/__ph/api/review/state?host=shop.example.com`, { headers: { Origin: shop } })
    expect(naked.status).toBe(403)
    expect(naked.headers.get('access-control-allow-origin')).toBeNull()

    const sites = (await (await fetch(`${control}/__ph/api/review/sites`)).json()) as { sites: { host: string; total: number }[] }
    expect(sites.sites.map((s) => s.host)).toEqual(['docs.example.com', 'shop.example.com'])
    const leaked = await fetch(`${control}/__ph/api/review/sites`, { headers: { Origin: shop } })
    expect(leaked.status).toBe(403)
    expect(leaked.headers.get('access-control-allow-origin')).toBeNull()

    const pageAll = await fetch(`${control}/__ph/api/review?scope=all&path=/&page=1`, { headers: { Origin: shop } })
    expect(pageAll.headers.get('access-control-allow-origin')).toBeNull()
    expect(((await pageAll.json()) as { total: number }).total).toBe(2)
    const pageShop = await fetch(`${control}/__ph/api/review?scope=all&path=/&page=1&host=shop.example.com`)
    expect(((await pageShop.json()) as { total: number; items: { say: string }[] }).items.map((i) => i.say)).toEqual(['Price is easy to miss'])
    expect((await fetch(`${control}/__ph/api/review?scope=all&path=/&page=1&host=not a host`)).status).toBe(400)

    const md = await fetch(`${control}/__ph/api/review/export.md?host=shop.example.com`)
    expect(md.headers.get('content-disposition')).toMatch(/review-shop\.example\.com\.md/)
    expect(await md.text()).toContain('Price is easy to miss')
    const exported = await (await fetch(`${control}/__ph/api/review/export.json?host=docs.example.com`)).text()
    expect(exported).toContain('Docs typo')
    expect(exported).not.toContain('Price is easy to miss')

    const prompt = await fetch(`${control}/__ph/api/review/prompt?host=shop.example.com&lang=en`)
    const promptText = await prompt.text()
    expect(promptText).toContain(`host=shop.example.com`)
    expect(promptText).toContain(`GET ${control}/__ph/api/review?`)
    expect(promptText).not.toContain('Price is easy to miss')

    const cleared = await fetch(`${control}/__ph/api/review/op`, {
      method: 'POST',
      headers: { Origin: shop, 'Content-Type': 'application/json', 'X-PH-Token': h.bookmarkletToken },
      body: JSON.stringify({ op: 'clear', host: 'shop.example.com' }),
    })
    expect(cleared.status).toBe(200)
    expect(((await cleared.json()) as { review: { items: ReviewItem[] } }).review.items).toEqual([])
    expect((await (await fetch(`${control}/__ph/api/review/sites`)).json() as { sites: { host: string }[] }).sites.map((s) => s.host)).toEqual(['docs.example.com'])

    expect((await fetch(`${control}/__ph/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403)
  })
})

describe('proxy no-agent', () => {
  let h: Harness
  let target: { url: string; close(): Promise<void> }

  afterAll(async () => {
    await h?.close()
    await target?.close()
  })

  it('does not start an agent and stores notes under the target host', async () => {
    const project = tempProject()
    target = await staticServer(project)
    const host = new URL(target.url).host
    h = await startHarness({ target: new URL(target.url), project, host: '127.0.0.1', appPort: await freePort(), controlPort: await freePort(), noAgent: true })
    expect(h.noAgent).toBe(true)
    expect(h.bookmarklet).toBe(false)
    expect(h.mode).toBe('review')
    expect(h.agents).toEqual([])
    h.gateway.runOwnerReview({ type: 'review_add', draft: { kind: 'note', url: target.url, selector: 'h1', note: 'On the proxied site' } })
    expect(h.gateway.reviewSlice(host).items.map((i) => i.note)).toEqual(['On the proxied site'])
    expect(h.gateway.reviewSlice('other.example.com').items).toEqual([])
    expect((await fetch(`${h.controlUrl}/__ph/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403)
  })
})
