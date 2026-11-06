import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChatEvent, LiveSession, ReviewItem, ServerMsg } from '../src/shared/protocol'
import { normalizePath } from '../src/shared/paths'
import { startHarness, type Harness } from '../src/server/harness'
import { AGENT_AUTHOR, ReviewStore, cleanPatch, detectMode, reviewArtifactAllowed } from '../src/server/review'
import { baseInstructions } from '../src/agents/skills'
import { freePort, staticServer, tempProject, WsClient } from './helpers'

process.env.PH_FAKE_AGENT = '1'

const ALICE = { id: 'u_alice', name: 'Alice', kind: 'human' as const }

describe('detectMode', () => {
  it('treats local and private hosts as source, public sites as review', () => {
    for (const u of ['http://localhost:5173', 'http://127.0.0.1:3000', 'http://app.localhost', 'http://192.168.1.4:8080', 'http://10.0.0.2', 'http://devbox:3000', 'http://[::1]:5173', 'http://my.internal'])
      expect(detectMode(new URL(u)), u).toBe('source')
    for (const u of ['https://skillhub.cn/', 'https://example.com', 'http://8.8.8.8']) expect(detectMode(new URL(u)), u).toBe('review')
  })
})

describe('normalizePath', () => {
  it('ignores hashes, trailing slashes, tracking and harness params, and param order', () => {
    expect(normalizePath('https://x.com/docs/')).toBe('/docs')
    expect(normalizePath('https://x.com/docs#a')).toBe('/docs')
    expect(normalizePath('https://x.com/?utm_source=a&b=2&a=1&ph-invite=z')).toBe('/?a=1&b=2')
    expect(normalizePath('/')).toBe('/')
  })
})

describe('review store', () => {
  it('validates, numbers, threads, approves, persists and exports', () => {
    const dir = tempProject()
    const s = new ReviewStore(dir)
    expect(() => s.add({ kind: 'note', selector: '', note: 'x', path: '/' })).toThrow()
    expect(() => s.add({ kind: 'patch', selector: 'h1', note: 'x', path: '/' })).toThrow(/patch/)
    const a = s.add({ kind: 'note', selector: 'h1', note: 'Unclear headline', path: 'https://x.com/#top' })
    const b = s.add({ kind: 'patch', selector: 'h1', note: '', path: '/', patch: { text: 'New' }, author: ALICE, anchor: { tag: 'h1', text: 'Old' } })
    expect([a.n, b.n]).toEqual([1, 2])
    expect(a).toMatchObject({ severity: 'suggestion', path: '/', status: 'open', author: AGENT_AUTHOR })
    expect(() => s.add({ kind: 'patch', selector: 'h1', note: '', path: '/', patch: { text: 'x' } })).toThrow(/note is required/)
    s.reply('#1', ALICE, 'Agreed')
    expect(s.editNote(a.id, '  Headline is unclear  ').note).toBe('Headline is unclear')
    expect(() => s.editNote(a.id, '   ')).toThrow(/needs text/)
    expect(() => s.editNote(b.id, 'x')).toThrow(/only notes/)
    s.setStatus(a.id, 'resolved', AGENT_AUTHOR, 'Done')
    s.approve('https://x.com/', ALICE, 'changes')
    s.approve('https://x.com/', ALICE, 'approved')
    const again = new ReviewStore(dir).snapshot()
    expect(again.items).toHaveLength(2)
    expect(again.items[0].replies.map((r) => r.text)).toEqual(['Agreed', 'Done'])
    expect(again.approvals).toEqual([expect.objectContaining({ path: '/', status: 'approved' })])
    const md = s.markdown('https://x.com/')
    expect(md).toContain('Approved by Alice')
    expect(md).toContain('从「Old」改成了「New」')
    expect(md).not.toMatch(/### #\d+ \[[^\]]+\] h1$/)
    expect(s.canRemove(b, ALICE, false)).toBe(true)
    expect(s.canRemove(a, ALICE, false)).toBe(false)
    s.clear()
    expect(new ReviewStore(dir).list()).toHaveLength(0)
  })

  it('migrates the old item array and drops html patches', () => {
    const dir = tempProject()
    writeFileSync(
      path.join(dir, 'review.json'),
      JSON.stringify([
        { id: 'rv_1', n: 1, kind: 'patch', path: '/a/', selector: 'h1', note: 'x', patch: { html: '<b>x</b>' }, createdAt: 1 },
        { id: 'rv_2', n: 2, kind: 'patch', path: '/', selector: 'p', note: 'y', patch: { html: '<b>y</b>', style: { color: 'red' } }, createdAt: 2 },
      ]),
    )
    const items = new ReviewStore(dir).list()
    expect(items[0]).toMatchObject({ kind: 'note', path: '/a', status: 'open', replies: [], author: AGENT_AUTHOR })
    expect(items[0].patch).toBeUndefined()
    expect(items[1].patch).toEqual({ style: { color: 'red' } })
  })

  it('only allows plain text, CSS and safe image attributes in patches', () => {
    expect(() => cleanPatch({ style: { background: 'url(https://x/y.png)' } })).toThrow()
    expect(() => cleanPatch({ style: { 'bad name': '1' } })).toThrow()
    expect(() => cleanPatch({ html: '<b>a</b>' } as never)).toThrow(/html/)
    expect(() => cleanPatch({ attrs: { src: 'javascript:alert(1)' } })).toThrow(/image src/)
    expect(cleanPatch({ attrs: { src: 'https://x.com/a.png', alt: 'A' } })).toEqual({ attrs: { src: 'https://x.com/a.png', alt: 'A' } })
    expect(cleanPatch({ style: { color: 'red' } })).toEqual({ style: { color: 'red' } })
  })

  it('only allows report-like artifacts in review mode', () => {
    expect(reviewArtifactAllowed('review.md')).toBe(true)
    expect(reviewArtifactAllowed('shot.png')).toBe(true)
    expect(reviewArtifactAllowed('mock.html')).toBe(false)
    expect(reviewArtifactAllowed('mock.svg')).toBe(false)
  })

  it('tells the agent how to work with and without source', () => {
    const review = baseInstructions({ project: '/p', target: 'https://x.com/', appUrl: 'http://localhost:1', mode: 'review' })
    expect(review).toMatch(/no source code/)
    expect(review).toMatch(/page_patch/)
    expect(review).toMatch(/reply_review/)
    expect(review).not.toMatch(/live_update/)
    expect(review).not.toMatch(/inner HTML/)
    const source = baseInstructions({ project: '/p', target: 'x', appUrl: 'y' })
    expect(source).toMatch(/live_update/)
    expect(source).toMatch(/resolve_review/)
  })
})

describe('review mode gateway with a shared team', () => {
  let h: Harness
  let target: Awaited<ReturnType<typeof staticServer>>
  let project: string
  let controlPort: number
  let ownerCookie: string
  let control: string
  const isEvent = (pred: (e: ChatEvent) => boolean) => (m: ServerMsg) => m.type === 'event' && pred(m.event)
  const textOf = (ws: WsClient) =>
    ws.msgs.filter((m): m is Extract<ServerMsg, { type: 'event' }> => m.type === 'event' && m.event.t === 'text').map((m) => (m.event as { delta: string }).delta).join('')
  const reviewMsg = (ws: WsClient, pred: (items: ReviewItem[]) => boolean, fromStart = true) =>
    ws.wait<Extract<ServerMsg, { type: 'review' }>>((m) => m.type === 'review' && pred(m.review.items), 5000, fromStart)

  beforeAll(async () => {
    project = tempProject()
    target = await staticServer(project)
    controlPort = await freePort()
    h = await startHarness({ target: new URL(target.url), project, host: '127.0.0.1', appPort: await freePort(), controlPort, agent: 'fake', mode: 'review', share: true })
    control = `http://localhost:${controlPort}`
    const r = await fetch(`${control}/__ph/ui`)
    ownerCookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
  })

  afterAll(async () => {
    await h?.close()
    await target?.close()
  })

  async function open(cookie: string, attached = true) {
    const ws = await WsClient.open(`ws://localhost:${controlPort}/__ph/ws`, { Cookie: cookie, Origin: control })
    ws.send({ type: 'subscribe', chat: null, role: 'chat' })
    await ws.wait((m) => m.type === 'hello', 5000, true)
    if (attached) ws.send({ type: 'page_control', on: false, attached: true, visible: true, tab: 't1', version: null })
    return ws
  }
  async function joinAsReviewer() {
    const r = await fetch(h.shareUrl!.replace(/^http:\/\/[^/]+/, control), { redirect: 'manual' })
    expect(r.status).toBe(302)
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
    expect(cookie).toMatch(/=r\./)
    return cookie
  }

  it('announces review mode with the invite link', async () => {
    expect(h.shareUrl).toMatch(/\/__ph\/join\?t=/)
    const ws = await open(ownerCookie, false)
    const hello = await ws.wait<Extract<ServerMsg, { type: 'hello' }>>((m) => m.type === 'hello', 5000, true)
    expect(hello).toMatchObject({ mode: 'review', me: { access: 'owner' }, share: h.shareUrl })
    ws.close()
  })

  it('renders Live candidates as page changes and keeps the accepted one as change items', async () => {
    const ws = await open(ownerCookie)
    const seen: string[] = []
    ws.onMessage = (m) => {
      if (m.type !== 'page_probe') return
      seen.push(m.selector)
      const count = m.selector === '.missing' ? 0 : 1
      ws.send({ type: 'probe_result', id: m.id, result: { count, url: target.url, label: m.selector, anchor: { tag: m.selector === 'h1.title' ? 'h1' : 'p' } } })
    }
    const live = (pred: (s: LiveSession) => boolean) => ws.wait<Extract<ServerMsg, { type: 'live' }>>((m) => m.type === 'live' && m.sessions.some(pred), 10000)
    const tgt = { selector: 'h1.title', tagName: 'H1', classes: ['title'], text: 'Hello fixture', outerHTML: '<h1 class="title">Hello fixture</h1>', styles: {}, url: target.url }

    ws.send({ type: 'live_op', request: { op: 'insert', target: tgt, position: 'after', prompt: 'a banner', url: target.url } })
    expect((await ws.wait<Extract<ServerMsg, { type: 'error' }>>((m) => m.type === 'error')).message).toMatch(/needs the page source/)

    ws.send({ type: 'live_op', request: { op: 'generate', action: 'bolder', count: 2, target: tgt, url: target.url } })
    const ready = (await live((s) => s.status === 'ready')).sessions.find((s) => s.status === 'ready')!
    expect(ready.source).toBe('patch')
    expect(ready.variants.map((v) => [v.label, v.changes?.length])).toEqual([['Bold', 2], ['Soft', 1]])
    expect(ready.variants[0].changes![1]).toMatchObject({ selector: '.hero-sub', patch: { text: 'Bold subtitle' }, anchor: { tag: 'p' } })
    expect(seen).toEqual(expect.arrayContaining(['h1.title', '.hero-sub']))

    ws.send({ type: 'live_op', request: { op: 'refine', sid: ready.sid, variant: 2, prompt: 'bigger' } })
    const refined = (await live((s) => s.sid === ready.sid && s.status === 'ready' && s.variants[1].label === 'Bigger')).sessions.find((s) => s.sid === ready.sid)!
    expect(refined.variants[1].changes).toEqual([expect.objectContaining({ patch: { style: { 'font-size': '40px' } } })])
    expect(refined.variants[0].label).toBe('Bold')

    ws.send({ type: 'live_op', request: { op: 'accept', sid: ready.sid, variant: 1 } })
    await live((s) => s.sid === ready.sid && s.status === 'accepted')
    const items = (await reviewMsg(ws, (list) => list.filter((i) => i.note === 'Live: Bold').length === 2)).review.items.filter((i) => i.note === 'Live: Bold')
    expect(items.map((i) => [i.selector, i.kind, i.author.id])).toEqual([['h1.title', 'patch', 'owner'], ['.hero-sub', 'patch', 'owner']])
    ws.send({ type: 'review_clear' })
    await reviewMsg(ws, (list) => list.length === 0, false)

    // Discarding needs no agent turn.
    ws.send({ type: 'live_op', request: { op: 'generate', action: 'quieter', count: 2, target: tgt, url: target.url } })
    const second = (await live((s) => s.status === 'ready' && s.sid !== ready.sid)).sessions.find((s) => s.status === 'ready' && s.sid !== ready.sid)!
    ws.send({ type: 'live_op', request: { op: 'discard', sid: second.sid } })
    await live((s) => s.sid === second.sid && s.status === 'discarded')
    ws.close()
  })

  it('turns a chat follow-up on waiting candidates into a new set, not review items', async () => {
    const ws = await open(ownerCookie)
    ws.onMessage = (m) => {
      if (m.type === 'page_probe') ws.send({ type: 'probe_result', id: m.id, result: { count: 1, url: target.url, label: m.selector, anchor: { tag: 'h1' } } })
    }
    const tgt = { selector: 'h1.title', tagName: 'H1', classes: ['title'], text: 'Hello fixture', outerHTML: '<h1 class="title">Hello fixture</h1>', styles: {}, url: target.url }
    ws.send({ type: 'live_op', request: { op: 'generate', action: 'bolder', count: 2, target: tgt, url: target.url } })
    const live = (pred: (s: LiveSession) => boolean) => ws.wait<Extract<ServerMsg, { type: 'live' }>>((m) => m.type === 'live' && m.sessions.some(pred), 10000)
    const s = (await live((x) => x.status === 'ready' && !x.accepted)).sessions.find((x) => x.status === 'ready')!
    ws.send({ type: 'prompt', message: { text: '再改改', attachments: [], picks: [] } })
    const revised = (await live((x) => x.sid === s.sid && x.status === 'ready' && x.variants[0]?.label === 'Airy')).sessions.find((x) => x.sid === s.sid)!
    expect(revised.variants.map((v) => v.label)).toEqual(['Airy', 'Roomy'])
    ws.send({ type: 'live_op', request: { op: 'discard', sid: s.sid } })
    await live((x) => x.sid === s.sid && x.status === 'discarded')
    ws.close()
  })

  it('refuses refining a missing candidate', async () => {
    const ws = await open(ownerCookie)
    ws.onMessage = (m) => {
      if (m.type === 'page_probe') ws.send({ type: 'probe_result', id: m.id, result: { count: 1, url: target.url, label: m.selector, anchor: { tag: 'h1' } } })
    }
    const tgt = { selector: 'h1.title', tagName: 'H1', classes: ['title'], text: 'Hello fixture', outerHTML: '<h1 class="title">Hello fixture</h1>', styles: {}, url: target.url }
    ws.send({ type: 'live_op', request: { op: 'generate', action: 'bolder', count: 2, target: tgt, url: target.url } })
    const s = (await ws.wait<Extract<ServerMsg, { type: 'live' }>>((m) => m.type === 'live' && m.sessions.some((x) => x.status === 'ready' && !x.accepted), 10000)).sessions.find((x) => x.status === 'ready')!
    ws.send({ type: 'live_op', request: { op: 'refine', sid: s.sid, variant: 9, prompt: 'x' } })
    expect((await ws.wait<Extract<ServerMsg, { type: 'error' }>>((m) => m.type === 'error')).message).toMatch(/choose a candidate/)
    ws.send({ type: 'live_op', request: { op: 'discard', sid: s.sid } })
    await ws.wait((m) => m.type === 'live' && m.sessions.some((x) => x.sid === s.sid && x.status === 'discarded'), 10000)
    ws.close()
  })

  it('survives malformed cookies and never demotes the owner through the invite link', async () => {
    const bad = await fetch(`${control}/__ph/api/config`, { headers: { Cookie: `x=%E0; ${ownerCookie}`, Origin: control } })
    expect(bad.status).toBe(200)
    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: controlPort, path: '/__ph/ws', headers: { Host: `localhost:${controlPort}`, Cookie: 'x=%E0', Connection: 'Upgrade', Upgrade: 'websocket' } })
      req.on('upgrade', () => resolve())
      req.on('response', () => resolve())
      req.on('error', () => resolve())
      req.end()
    })
    expect((await fetch(`${control}/__ph/api/config`, { headers: { Cookie: ownerCookie, Origin: control } })).status).toBe(200)

    const r = await fetch(h.shareUrl!.replace(/^http:\/\/[^/]+/, control), { redirect: 'manual', headers: { Cookie: ownerCookie } })
    expect(r.status).toBe(302)
    expect(r.headers.get('set-cookie') ?? '').not.toMatch(/=r\./)
    const ws = await open(ownerCookie, false)
    expect(await ws.wait<Extract<ServerMsg, { type: 'hello' }>>((m) => m.type === 'hello', 5000, true)).toMatchObject({ me: { access: 'owner' } })
    ws.close()
  })

  it('rejects bad invites and keeps reviewers away from chats, the API and the history', async () => {
    expect((await fetch(`${control}/__ph/join?t=nope`, { redirect: 'manual' })).status).toBe(403)
    const cookie = await joinAsReviewer()
    const api = (p: string, init: RequestInit = {}) => fetch(`${control}/__ph/api/${p}`, { ...init, headers: { Cookie: cookie, Origin: control, 'X-PH': '1', ...(init.headers ?? {}) } })
    expect((await api('chats')).status).toBe(403)
    expect((await api('chats', { method: 'POST', body: '{}' })).status).toBe(403)
    expect((await api('artifacts')).status).toBe(200)
    expect((await fetch(`${control}/__ph/history`, { headers: { Cookie: cookie } })).status).toBe(403)
    const forged = cookie.replace(/\.[^.]+$/, '.AAAA')
    expect((await api('artifacts', { headers: { Cookie: forged } })).status).toBe(403)

    const ws = await open(cookie)
    const hello = await ws.wait<Extract<ServerMsg, { type: 'hello' }>>((m) => m.type === 'hello', 5000, true)
    expect(hello).toMatchObject({ project: '', agents: [], me: { access: 'reviewer', name: '' } })
    expect(hello.share).toBeUndefined()
    expect(ws.msgs.some((m) => m.type === 'chats' || m.type === 'snapshot' || m.type === 'live')).toBe(false)
    ws.send({ type: 'prompt', message: { text: 'hi', attachments: [], picks: [] } })
    expect((await ws.wait<Extract<ServerMsg, { type: 'error' }>>((m) => m.type === 'error')).message).toMatch(/only the owner/)
    ws.msgs = []
    ws.send({ type: 'live_op', request: { op: 'steer', prompt: 'make it bold', url: target.url } })
    expect((await ws.wait<Extract<ServerMsg, { type: 'error' }>>((m) => m.type === 'error')).message).toMatch(/only the owner/)
    ws.send({ type: 'review_add', draft: { kind: 'note', url: `${target.url}`, selector: 'h1', note: 'x' } })
    expect((await ws.wait<Extract<ServerMsg, { type: 'error' }>>((m) => m.type === 'error')).message).toMatch(/name/)
    ws.close()
  })

  it('lets reviewers comment, edit, reply and approve; the agent sees it and resolves', async () => {
    const owner = await open(ownerCookie)
    const cookie = await joinAsReviewer()
    const rv = await open(cookie, false)
    rv.send({ type: 'set_name', name: 'Alice' })
    await rv.wait((m) => m.type === 'hello' && m.me.name === 'Alice')
    rv.send({ type: 'review_add', draft: { kind: 'note', url: `${target.url}?utm_source=x`, selector: 'h1.title', note: 'Too vague', severity: 'issue', anchor: { tag: 'h1', text: 'Hello fixture' } } })
    rv.send({ type: 'review_add', draft: { kind: 'patch', url: target.url, selector: 'h1.title', note: '', patch: { text: 'Hello team' } } })
    const got = await reviewMsg(owner, (items) => items.length === 2)
    const [note, patch] = got.review.items
    expect(note).toMatchObject({ author: { name: 'Alice', kind: 'human' }, path: '/', severity: 'issue', anchor: { tag: 'h1' } })
    expect(patch).toMatchObject({ kind: 'patch', patch: { text: 'Hello team' } })
    rv.send({ type: 'review_approve', url: target.url, status: 'changes' })
    await owner.wait((m) => m.type === 'review' && m.review.approvals.length === 1)

    owner.send({ type: 'prompt', message: { text: `fix it [fake:resolve=${note.n}]`, attachments: [], picks: [] } })
    await owner.wait(isEvent((e) => e.t === 'turn_end'))
    expect(textOf(owner)).toMatch(/by Alice \(person\)/)
    const resolved = await reviewMsg(rv, (items) => items[0]?.status === 'resolved')
    expect(resolved.review.items[0].replies[0]).toMatchObject({ author: { id: 'agent' }, text: 'Fixed in the copy.' })

    // Reviewers delete only their own items; the owner can delete anything.
    owner.send({ type: 'review_add', draft: { kind: 'note', url: target.url, selector: 'p', note: 'Owner note' } })
    const withOwner = await reviewMsg(rv, (items) => items.length === 3, false)
    const ownerNote = withOwner.review.items[2]
    expect(ownerNote.author.id).toBe('owner')
    rv.send({ type: 'review_edit', id: ownerNote.id, note: 'hijacked' })
    expect((await rv.wait<Extract<ServerMsg, { type: 'error' }>>((m) => m.type === 'error' && /edit/.test(m.message))).message).toMatch(/author or the owner/)
    owner.send({ type: 'review_edit', id: ownerNote.id, note: 'Owner note, edited' })
    await reviewMsg(rv, (items) => items[2]?.note === 'Owner note, edited', false)
    rv.send({ type: 'review_remove', id: ownerNote.id })
    expect((await rv.wait<Extract<ServerMsg, { type: 'error' }>>((m) => m.type === 'error')).message).toMatch(/author or the owner/)
    rv.send({ type: 'review_remove', id: patch.id })
    await reviewMsg(owner, (items) => items.length === 2, false)
    owner.send({ type: 'review_clear' })
    await reviewMsg(rv, (items) => items.length === 0, false)
    rv.send({ type: 'review_clear' })
    expect((await rv.wait<Extract<ServerMsg, { type: 'error' }>>((m) => m.type === 'error')).message).toMatch(/only the owner/)
    owner.close()
    rv.close()
  })

  it('pins agent notes and patches after probing the page, with anchors', async () => {
    const ws = await open(ownerCookie)
    ws.onMessage = (m) => {
      if (m.type !== 'page_probe') return
      const count = m.selector === 'h1.title' ? 1 : 0
      ws.send({ type: 'probe_result', id: m.id, result: { count, url: `${target.url}pricing/?x=1#top`, label: 'h1 "Hello fixture"', anchor: { tag: 'h1', classes: ['title'], text: 'Hello fixture' } } })
    }
    ws.send({ type: 'prompt', message: { text: 'review [fake:note=h1.title] [fake:patch=h1.title]', attachments: [], picks: [] } })
    await ws.wait(isEvent((e) => e.t === 'turn_end'))
    const rv = await reviewMsg(ws, (items) => items.length === 2)
    const [note, patch] = rv.review.items
    expect(note).toMatchObject({ kind: 'note', severity: 'issue', path: '/pricing?x=1', label: 'h1 "Hello fixture"', anchor: { tag: 'h1', text: 'Hello fixture' }, author: { id: 'agent' } })
    expect(patch).toMatchObject({ kind: 'patch', patch: { style: { color: 'rgb(220, 38, 38)' }, text: 'Reviewed headline' } })
    expect(textOf(ws)).toMatch(/Note #\d+ is pinned on \/pricing/)

    ws.msgs = []
    ws.send({ type: 'prompt', message: { text: 'again [fake:note=.missing]', attachments: [], picks: [] } })
    const tool = await ws.wait<Extract<ServerMsg, { type: 'event' }>>(isEvent((e) => e.t === 'tool' && e.status === 'error'))
    expect((tool.event as { output: string }).output).toMatch(/No element/)
    await ws.wait(isEvent((e) => e.t === 'turn_end'))

    ws.send({ type: 'review_export' })
    const art = await ws.wait<Extract<ServerMsg, { type: 'artifacts' }>>((m) => m.type === 'artifacts' && m.open === 'page-review.md')
    expect(art.open).toBe('page-review.md')
    ws.send({ type: 'review_clear' })
    await reviewMsg(ws, (items) => items.length === 0, false)
    expect(existsSync(path.join(project, '.page-harness', 'review.json'))).toBe(true)
    ws.close()
  })

  it('rejects HTML artifacts and falls back to the turn URL when no page answers', async () => {
    const ws = await open(ownerCookie, false)
    ws.send({ type: 'prompt', message: { text: 'mock [fake:html] [fake:note=h1]', attachments: [], picks: [], pageUrl: `${target.url}docs` } })
    await ws.wait(isEvent((e) => e.t === 'turn_end'), 15000)
    const errors = ws.msgs.filter((m) => m.type === 'event' && m.event.t === 'tool' && m.event.status === 'error')
    expect(JSON.stringify(errors)).toMatch(/mock\.html.*not saved/)
    expect(existsSync(path.join(project, '.page-harness', 'artifacts', 'mock.html'))).toBe(false)
    const rv = await reviewMsg(ws, (items) => items.length === 1)
    expect(rv.review.items[0].path).toBe('/docs')
    expect(textOf(ws)).toMatch(/selector is unchecked/)
    expect(readFileSync(path.join(project, '.page-harness', 'review.json'), 'utf8')).toContain('/docs')
    ws.close()
  })
})

const lanIp = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address

describe.skipIf(!lanIp)('sharing on the network', () => {
  let h: Harness
  let target: Awaited<ReturnType<typeof staticServer>>
  let appPort: number
  let controlPort: number

  beforeAll(async () => {
    const project = tempProject()
    target = await staticServer(project)
    appPort = await freePort()
    controlPort = await freePort()
    h = await startHarness({ target: new URL(target.url), project, host: '0.0.0.0', appPort, controlPort, agent: 'fake', mode: 'review', share: true })
  })

  afterAll(async () => {
    await h?.close()
    await target?.close()
  })

  it('needs the invite for the page, the panel and the API from other machines', async () => {
    const app = `http://${lanIp}:${appPort}`
    const control = `http://${lanIp}:${controlPort}`
    expect((await fetch(`${app}/`)).status).toBe(403)
    expect((await fetch(`${app}/__ph/overlay.js`)).status).toBe(403)
    expect((await fetch(`${control}/__ph/ui`)).status).toBe(403)
    expect((await fetch(`${control}/__ph/api/artifacts`)).status).toBe(403)
    expect(h.shareUrl).toContain(`:${controlPort}/__ph/join?t=`)
    const join = await fetch(h.shareUrl!.replace(/^http:\/\/[^/]+/, control), { redirect: 'manual' })
    expect(join.headers.get('location')).toBe(`${app}/`)
    const cookies = join.headers.getSetCookie().map((c) => c.split(';')[0])
    expect(cookies).toHaveLength(2)
    const cookie = cookies.join('; ')
    const page = await fetch(`${app}/`, { headers: { Cookie: cookie } })
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('/__ph/overlay.js')
    // 503 when the client is not built yet (unit tests run before the build); never 403.
    expect([200, 503]).toContain((await fetch(`${control}/__ph/ui`, { headers: { Cookie: cookie } })).status)
    expect((await fetch(`${control}/__ph/history`, { headers: { Cookie: cookie } })).status).toBe(403)
    // The local machine stays the owner without any link.
    expect((await fetch(`http://localhost:${appPort}/`)).status).toBe(200)
    // Reviewers can curl the control port, so they must not get the resolve secret.
    expect(await (await fetch(`${app}/__ph/overlay.js`, { headers: { Cookie: cookie } })).text()).not.toContain(h.resolveToken)
    const ownerJs = await fetch(`http://localhost:${appPort}/__ph/overlay.js`)
    if (ownerJs.status === 200) expect(await ownerJs.text()).toContain(h.resolveToken)
  })
})
