import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChatEvent, ServerMsg } from '../src/shared/protocol'
import { startHarness, type Harness } from '../src/server/harness'
import { freePort, staticServer, tempProject, WsClient } from './helpers'

process.env.PH_FAKE_AGENT = '1'

let h: Harness
let target: Awaited<ReturnType<typeof staticServer>>
let project: string
let appPort: number
let controlPort: number
let cookie: string
let control: string

const isEvent = (pred: (e: ChatEvent) => boolean) => (m: ServerMsg) => m.type === 'event' && pred(m.event)

beforeAll(async () => {
  project = tempProject()
  target = await staticServer(project)
  appPort = await freePort()
  controlPort = await freePort()
  h = await startHarness({ target: new URL(target.url), project, host: '127.0.0.1', appPort, controlPort, agent: 'fake' })
  control = `http://localhost:${controlPort}`
  const r = await fetch(`${control}/__ph/ui`)
  const setCookie = r.headers.get('set-cookie') ?? ''
  cookie = setCookie.split(';')[0]
  expect(cookie).toMatch(/^__ph_\d+=/)
  expect(setCookie).toContain('SameSite=None')
  expect(setCookie).toContain('Secure')
  expect(setCookie).toContain('Partitioned')
})

afterAll(async () => {
  await h?.close()
  await target?.close()
})

async function openChat(): Promise<{ ws: WsClient; chatId: string }> {
  const ws = await WsClient.open(`ws://localhost:${controlPort}/__ph/ws`, { Cookie: cookie, Origin: control })
  ws.send({ type: 'subscribe', chat: null, role: 'chat' })
  const snap = await ws.wait<Extract<ServerMsg, { type: 'snapshot' }>>((m) => m.type === 'snapshot', 5000, true)
  return { ws, chatId: snap.snapshot.chat.id }
}

const api = (p: string, init: RequestInit = {}) =>
  fetch(`${control}/__ph/api/${p}`, { ...init, headers: { Cookie: cookie, Origin: control, 'X-PH': '1', 'Sec-Fetch-Site': 'same-origin', ...(init.headers ?? {}) } })

describe('proxy', () => {
  it('injects the overlay into HTML right after <head>', async () => {
    const html = await (await fetch(`http://localhost:${appPort}/`)).text()
    expect(html).toMatch(/<head><script src="\/__ph\/overlay\.js" data-page-harness/)
    expect(html).toContain('Hello fixture')
  })

  it('rewrites redirects to the target origin', async () => {
    const r = await fetch(`http://localhost:${appPort}/redirect`, { redirect: 'manual' })
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe(`http://localhost:${appPort}/`)
  })

  it('rejects unknown Host headers', async () => {
    const http = await import('node:http')
    const status = await new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port: appPort, path: '/', headers: { Host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0))
    })
    expect(status).toBe(421)
  })
})

describe('internal auth', () => {
  it('rejects API calls without the session cookie', async () => {
    const r = await fetch(`${control}/__ph/api/chats`)
    expect(r.status).toBe(403)
  })

  it('rejects cross-site reads and writes without X-PH', async () => {
    expect((await api('chats', { headers: { 'Sec-Fetch-Site': 'cross-site', Origin: '' } })).status).toBe(403)
    expect((await api('chats', { method: 'POST', headers: { 'X-PH': '' }, body: '{}' })).status).toBe(403)
    expect((await api('chats', { method: 'POST', headers: { Origin: `http://localhost:${appPort}` }, body: '{}' })).status).toBe(403)
  })

  it('rejects MCP calls without a valid turn token or from browsers', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    expect((await fetch(`${control}/__ph/mcp`, { method: 'POST', headers, body })).status).toBe(401)
    expect((await fetch(`${control}/__ph/mcp`, { method: 'POST', headers: { ...headers, Authorization: 'Bearer nope' }, body })).status).toBe(401)
    const token = h.auth.issueMcpToken({ chatId: 'c', turnId: 't' })
    expect((await fetch(`${control}/__ph/mcp`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}`, Origin: control }, body })).status).toBe(401)
    const ok = await fetch(`${control}/__ph/mcp`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body })
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('page_state')
    h.auth.revokeMcpToken(token)
  })

  it('rejects WebSocket handshakes with a foreign Origin', async () => {
    await expect(WsClient.open(`ws://localhost:${controlPort}/__ph/ws`, { Cookie: cookie, Origin: `http://localhost:${appPort}` })).rejects.toThrow(/403/)
    await expect(WsClient.open(`ws://localhost:${controlPort}/__ph/ws`, { Origin: control })).rejects.toThrow(/403/)
  })

  it('does not forward the panel cookie to the target', async () => {
    let seen = ''
    target.server.prependOnceListener('request', (req) => (seen = req.headers.cookie ?? ''))
    await fetch(`http://localhost:${appPort}/`, { headers: { Cookie: `${cookie}; app=1` } })
    expect(seen).toBe('app=1')
  })
})

describe('chat gateway', () => {
  it('runs a turn, writes an artifact and persists the log', async () => {
    const { ws, chatId } = await openChat()
    ws.send({ type: 'prompt', message: { text: 'hello there [fake:artifact]', attachments: [], picks: [] } })
    await ws.wait(isEvent((e) => e.t === 'turn_end'))
    const art = await ws.wait<Extract<ServerMsg, { type: 'artifacts' }>>((m) => m.type === 'artifacts' && m.artifacts.some((a) => a.name === 'report.md'), 5000, true)
    expect(art.artifacts[0].latest).toBe(1)
    const text = ws.msgs.filter((m): m is Extract<ServerMsg, { type: 'event' }> => m.type === 'event' && m.event.t === 'text').map((m) => (m.event as { delta: string }).delta).join('')
    expect(text).toContain('Echo: hello there')
    expect(existsSync(path.join(project, '.page-harness', 'chats', chatId, 'events.jsonl'))).toBe(true)

    const snap = (await (await api(`chats/${chatId}`)).json()) as any
    expect(snap.turns).toHaveLength(1)
    expect(snap.turns[0].status).toBe('done')
    expect(snap.turns[0].artifacts).toEqual([{ name: 'report.md', version: 1 }])

    const hits = (await (await api(`search?q=${encodeURIComponent('hello there')}`)).json()) as any
    expect(hits.some((x: { chatId: string }) => x.chatId === chatId)).toBe(true)

    const raw = await api('artifacts/report.md/raw')
    expect(await raw.text()).toContain('# Report')
    ws.close()
  })

  it('queues messages FIFO and cancels the running turn', async () => {
    const { ws } = await openChat()
    ws.send({ type: 'prompt', message: { text: 'first [fake:slow]', attachments: [], picks: [] } })
    ws.send({ type: 'prompt', message: { text: 'second', attachments: [], picks: [] } })
    const state = await ws.wait<Extract<ServerMsg, { type: 'state' }>>((m) => m.type === 'state' && m.queue.length === 1 && m.running !== null)
    expect(state.queue[0].text).toBe('second')
    await ws.wait(isEvent((e) => e.t === 'text'))
    ws.send({ type: 'cancel' })
    const end = await ws.wait<Extract<ServerMsg, { type: 'event' }>>(isEvent((e) => e.t === 'turn_end'))
    expect((end.event as { status: string }).status).toBe('cancelled')
    const begin = await ws.wait<Extract<ServerMsg, { type: 'event' }>>(isEvent((e) => e.t === 'turn_begin' && e.user.text === 'second'), 5000, true)
    expect((begin.event as { user: { text: string } }).user.text).toBe('second')
    await ws.wait(isEvent((e) => e.t === 'turn_end' && e.turnId === begin.event.turnId), 5000, true)
    ws.close()
  })

  it('blocks ask_question until the user answers', async () => {
    const { ws } = await openChat()
    ws.send({ type: 'prompt', message: { text: 'pick [fake:ask]', attachments: [], picks: [] } })
    const ask = await ws.wait<Extract<ServerMsg, { type: 'event' }>>(isEvent((e) => e.t === 'ask'))
    const askId = (ask.event as { askId: string }).askId
    ws.send({ type: 'answer', askId, answer: { answers: { color: { selected: ['blue'] } } } })
    await ws.wait(isEvent((e) => e.t === 'turn_end'))
    const text = ws.msgs.filter((m): m is Extract<ServerMsg, { type: 'event' }> => m.type === 'event' && m.event.t === 'text').map((m) => (m.event as { delta: string }).delta).join('')
    expect(text).toContain('Blue')
    ws.close()
  })

  it('routes page commands to the tab that holds control', async () => {
    const { ws } = await openChat()
    ws.send({ type: 'page_control', on: true, visible: true, tab: 'tab1', version: 1 })
    await ws.wait((m) => m.type === 'page_status' && m.status === 'online')
    const actions: string[] = []
    ws.onMessage = (m) => {
      if (m.type !== 'page_cmd') return
      actions.push(m.cmd.action)
      const state = { stateId: 's1', url: 'http://x/', title: 'Fixture', content: '[0]<button>Save</button>', truncated: false }
      ws.send({ type: 'page_result', id: m.id, result: { ok: true, state } })
    }
    ws.send({ type: 'prompt', message: { text: 'click it [fake:click=Save]', attachments: [], picks: [] } })
    await ws.wait(isEvent((e) => e.t === 'turn_end'))
    expect(actions).toEqual(['state', 'click'])
    ws.close()
  })

  it('reports page control as offline when no tab allows it', async () => {
    const { ws } = await openChat()
    ws.send({ type: 'prompt', message: { text: 'click [fake:click=Save]', attachments: [], picks: [] } })
    const tool = await ws.wait<Extract<ServerMsg, { type: 'event' }>>(isEvent((e) => e.t === 'tool' && e.status === 'error'))
    expect((tool.event as { output: string }).output).toMatch(/offline/)
    await ws.wait(isEvent((e) => e.t === 'turn_end'))
    ws.close()
  })

  it('pages older turns', async () => {
    const chats = (await (await api('chats')).json()) as any
    const id = chats[chats.length - 1].id
    const r = (await (await api(`chats/${id}/turns?limit=1`)).json()) as any
    expect(r.turns).toHaveLength(1)
  })
})

describe('live variants', () => {
  it('generates candidates in the source, then accepts one', async () => {
    const { ws } = await openChat()
    const outerHTML = '<h1 class="title">Hello fixture</h1>'
    ws.send({
      type: 'live_op',
      request: { op: 'generate', action: 'bolder', count: 2, target: { selector: 'h1.title', tagName: 'H1', classes: ['title'], text: 'Hello fixture', outerHTML, styles: {}, url: target.url }, url: target.url },
    })
    const ready = await ws.wait<Extract<ServerMsg, { type: 'live' }>>((m) => m.type === 'live' && m.sessions.some((s) => s.status === 'ready'), 10000)
    const s = ready.sessions.find((x) => x.status === 'ready')!
    expect(s.variants.map((v) => v.label)).toEqual(['Bold', 'Soft'])
    expect(readFileSync(path.join(project, 'index.html'), 'utf8')).toContain(`data-ph-live="${s.sid}"`)

    ws.send({ type: 'live_op', request: { op: 'accept', sid: s.sid, variant: 1 } })
    await ws.wait((m) => m.type === 'live' && m.sessions.some((x) => x.sid === s.sid && x.status === 'accepted'), 10000)
    const src = readFileSync(path.join(project, 'index.html'), 'utf8')
    expect(src).not.toContain('data-ph-')
    expect(src).toContain('<h1 style="font-weight:800" class="title">Hello fixture</h1>')
    ws.close()
  })

  it('rejects invalid transitions', async () => {
    const { ws } = await openChat()
    ws.send({ type: 'live_op', request: { op: 'accept', sid: 'Lnope', variant: 1 } })
    const err = await ws.wait<Extract<ServerMsg, { type: 'error' }>>((m) => m.type === 'error')
    expect(err.message).toMatch(/unknown/)
    ws.close()
  })
})
