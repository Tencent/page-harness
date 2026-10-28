import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ReviewItem, ServerMsg } from '../src/shared/protocol'
import { startHarness, type Harness } from '../src/server/harness'
import { freePort, staticServer, tempProject, WsClient } from './helpers'

process.env.PH_FAKE_AGENT = '1'

const human = { id: 'u', name: 'Ada', kind: 'human' as const }

function note(p: Partial<ReviewItem> & Pick<ReviewItem, 'id' | 'n'>): ReviewItem {
  return {
    host: '',
    kind: 'note',
    path: '/',
    selector: 'h1',
    note: '',
    author: human,
    status: 'open',
    replies: [],
    createdAt: 1,
    ...p,
  }
}

const stored: ReviewItem[] = [
  note({
    id: 'rv_1',
    n: 1,
    selector: 'h1',
    anchor: { tag: 'h1', text: 'Hello title' },
    note: 'Headline wraps on a narrow screen',
    severity: 'issue',
    replies: [{ id: 'rp_1', author: human, text: 'Keep it to one line', at: 2 }],
  }),
  note({
    id: 'rv_2',
    n: 2,
    kind: 'patch',
    selector: 'h1.title',
    anchor: { tag: 'h1', text: 'Old headline' },
    note: 'Shorter title',
    patch: { text: 'New headline', style: { color: 'red' }, from: { color: 'black' } },
  }),
  note({ id: 'rv_4', n: 4, note: 'Already fixed', status: 'resolved' }),
  note({ id: 'rv_5', n: 5, path: '/pricing', selector: 'table', note: 'Yearly price is missing' }),
]

let h: Harness
let target: Awaited<ReturnType<typeof staticServer>>
let project: string
let controlPort: number
let control: string
let cookie: string

beforeAll(async () => {
  project = tempProject()
  const dataDir = path.join(project, '.page-harness')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(path.join(dataDir, 'review.json'), JSON.stringify({ items: stored, approvals: [] }))
  target = await staticServer(project)
  const appPort = await freePort()
  controlPort = await freePort()
  h = await startHarness({ target: new URL(target.url), project, host: '127.0.0.1', appPort, controlPort, agent: 'fake' })
  control = `http://127.0.0.1:${controlPort}`
  const ui = await fetch(`${control}/__ph/ui`)
  cookie = (ui.headers.get('set-cookie') ?? '').split(';')[0]
})

afterAll(async () => {
  await h?.close()
  await target?.close()
})

const reviewUrl = (q: string) => `${control}/__ph/api/review?${q}`

describe('local review API', () => {
  it('pages open notes, keeps other paths and resolved notes out, and does not change status', async () => {
    const first = await fetch(reviewUrl('scope=here&path=%2F&page=1&pageSize=1'), { headers: { Accept: 'application/json' } })
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toContain('application/json')
    const page1 = await first.json()
    expect(page1).toMatchObject({ page: 1, pageSize: 1, total: 2 })
    expect(page1.items).toHaveLength(1)
    expect(page1.items[0]).toMatchObject({
      n: 1,
      kind: 'issue',
      path: '/',
      say: 'Headline wraps on a narrow screen',
      selector: 'h1',
      replies: [{ author: 'Ada', text: 'Keep it to one line' }],
    })
    expect(page1.items[0].where).toContain('Hello title')
    expect(JSON.stringify(page1)).not.toContain('Already fixed')
    expect(JSON.stringify(page1)).not.toContain('Yearly price')

    const again = await (await fetch(reviewUrl('scope=here&path=%2F&page=1&pageSize=1'))).json()
    expect(again).toEqual(page1)

    const page2 = await (await fetch(reviewUrl('scope=here&path=%2F&page=2&pageSize=1'))).json()
    expect(page2).toMatchObject({ page: 2, pageSize: 1, total: 2 })
    expect(page2.items).toHaveLength(1)
    expect(page2.items[0]).toMatchObject({
      n: 2,
      kind: 'patch',
      path: '/',
      say: 'Shorter title',
      selector: 'h1.title',
      before: 'Old headline\ncolor: black',
      after: 'New headline\ncolor: red',
    })

    const empty = await (await fetch(reviewUrl('scope=here&path=%2F&page=3&pageSize=1'))).json()
    expect(empty).toEqual({ page: 3, pageSize: 1, total: 2, items: [] })

    const defaults = await (await fetch(reviewUrl('scope=here&path=%2F'))).json()
    expect(defaults).toMatchObject({ page: 1, pageSize: 20, total: 2 })
    expect(defaults.items.map((i: { n: number }) => i.n)).toEqual([1, 2])

    const pricing = await (await fetch(reviewUrl('scope=here&path=%2Fpricing&pageSize=20'))).json()
    expect(pricing.total).toBe(1)
    expect(pricing.items.map((i: { n: number }) => i.n)).toEqual([5])

    const all = await (await fetch(reviewUrl('scope=all&path=%2F&page=1&pageSize=2'))).json()
    expect(all).toMatchObject({ total: 3 })
    expect(all.items.map((i: { n: number }) => i.n)).toEqual([1, 2])
    const allNext = await (await fetch(reviewUrl('scope=all&path=%2F&page=2&pageSize=2'))).json()
    expect(allNext.items.map((i: { n: number; path: string }) => [i.n, i.path])).toEqual([[5, '/pricing']])

    expect((await fetch(reviewUrl('scope=nope'))).status).toBe(400)
    expect((await fetch(reviewUrl('scope=here&page=0'))).status).toBe(400)
  })

  it('marks one note resolved, drops it from later pages, and refuses everything else', async () => {
    const ws = await WsClient.open(`ws://127.0.0.1:${controlPort}/__ph/ws`, { Cookie: cookie, Origin: control })
    await ws.wait((m) => m.type === 'review', 5000, true)
    const seen = ws.wait<Extract<ServerMsg, { type: 'review' }>>((m) => m.type === 'review' && m.review.items.some((i) => i.n === 1 && i.status === 'resolved'))

    const ok = await fetch(`${control}/__ph/api/review/resolve`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: 1, result: 'Shortened the headline' }),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, n: 1, status: 'resolved' })

    const broadcast = await seen
    const marked = broadcast.review.items.find((i) => i.n === 1)!
    expect(marked.status).toBe('resolved')
    expect(marked.replies.map((r) => r.text)).toEqual(['Keep it to one line', 'Shortened the headline'])
    expect(broadcast.review.items).toHaveLength(stored.length)

    const after = await (await fetch(reviewUrl('scope=here&path=%2F&pageSize=20'))).json()
    expect(after.items.map((i: { n: number }) => i.n)).toEqual([2])
    expect(JSON.stringify(after)).not.toContain('Headline wraps')

    const again = await fetch(`${control}/__ph/api/review/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: 1, result: 'again' }),
    })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ ok: true, n: 1, status: 'resolved', already: true })
    const saved = JSON.parse(readFileSync(path.join(project, '.page-harness', 'review.json'), 'utf8')) as { items: ReviewItem[] }
    expect(saved.items).toHaveLength(stored.length)
    expect(saved.items.find((i) => i.n === 1)?.replies).toHaveLength(2)
    expect(saved.items.find((i) => i.n === 2)?.status).toBe('open')

    const missing = await fetch(`${control}/__ph/api/review/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: 99, result: 'nope' }),
    })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ ok: false, error: 'unknown' })
    const still = await (await fetch(reviewUrl('scope=here&path=%2F&pageSize=20'))).json()
    expect(still.items.map((i: { n: number }) => i.n)).toEqual([2])

    expect((await fetch(`${control}/__ph/api/chats`)).status).toBe(403)
    expect((await fetch(`${control}/__ph/api/chats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403)
    expect((await fetch(`${control}/__ph/api/live`)).status).toBe(403)
    expect((await fetch(`${control}/__ph/api/review/resolve`)).status).toBe(403)
    await expect(WsClient.open(`ws://127.0.0.1:${controlPort}/__ph/ws`, { Origin: control })).rejects.toThrow(/403/)
    ws.close()
  })

  // The endpoint is the local agent's, reached with plain curl: no cookie, no token. A page must
  // not reach it, so anything a browser sends is refused. A page can post cross-site without a
  // preflight by using a simple content type, which is why Content-Type is not the check.
  it('refuses a page that tries to mark notes resolved', async () => {
    const items = () => (JSON.parse(readFileSync(path.join(project, '.page-harness', 'review.json'), 'utf8')) as { items: ReviewItem[] }).items
    const statuses = () => Object.fromEntries(items().map((i) => [i.n, i.status]))
    // Whatever the tests above left open; nothing here depends on a specific number.
    const n = items().find((i) => i.status === 'open')!.n
    const before = statuses()

    const resolve = (headers: Record<string, string>) =>
      fetch(`${control}/__ph/api/review/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ n, result: 'marked by a page' }),
      })

    const simpleType = await fetch(`${control}/__ph/api/review/resolve`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ n, result: 'marked by a page' }),
    })
    expect(simpleType.status).toBe(403)
    expect(await simpleType.json()).toEqual({ ok: false, error: 'browsers may not call the local agent API' })
    expect((await resolve({ Origin: 'https://evil.example.com' })).status).toBe(403)
    expect((await resolve({ Origin: control })).status).toBe(403)
    expect((await resolve({ 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    expect((await resolve({ Cookie: cookie })).status).toBe(403)

    const preflight = await fetch(`${control}/__ph/api/review/resolve`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()

    // Nothing above touched the notes, and the documented curl call still works.
    expect(statuses()).toEqual(before)
    const curl = await fetch(`${control}/__ph/api/review/resolve`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ n, result: 'Handled' }),
    })
    expect(curl.status).toBe(200)
    expect(await curl.json()).toEqual({ ok: true, n, status: 'resolved' })
    expect(statuses()[n]).toBe('resolved')
  })
})
