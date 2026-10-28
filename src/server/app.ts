// Two listeners:
//   app port      the proxied frontend plus the injected page scripts (/__ph/overlay.js …)
//   control port  panel UI, history page, JSON API, WebSocket and the agent MCP endpoint
// The panel runs on its own origin so scripts of the target page cannot read or drive it.
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import type { AgentRegistry } from '../agents'
import type { ClientMsg, Lang, ReviewDraft, ReviewItem, ReviewLook, ServerMsg } from '../shared/protocol'
import { normalizeHost } from '../shared/paths'
import { REVIEW_PAGE_SIZE, reviewMarkdown, reviewPrompt } from '../shared/review-read'
import { embedNext, safeEqual } from './auth'
import { HOME_CSS, HOME_JS, homeFontFile, homeHtml, packageVersion } from './homePage'
import { newId } from '../shared/util'
import type { ArtifactStore } from './artifacts'
import type { Auth, Who } from './auth'
import type { Gateway } from './gateway'
import { OVERLAY_PATH } from './inject'
import type { LiveManager } from './live'
import { LiveError } from './live'
import { log } from './log'
import { handleMcp } from './mcp'
import { createProxy, RELAY_PREFIX } from './proxy'
import type { Uploads } from './uploads'
import { MAX_UPLOAD_BYTES } from './uploads'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}

export function clientDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [path.join(here, 'client'), path.join(here, '..', 'client'), path.join(here, '..', '..', 'dist', 'client')]
  return candidates.find((d) => existsSync(path.join(d, 'page', 'overlay.js'))) ?? candidates[0]
}

export interface AppOptions {
  /** Absent in bookmarklet mode: only the control port listens. */
  target?: URL
  host: string
  appPort: number
  controlPort: number
  project: string
  auth: Auth
  gateway: Gateway
  registry: AgentRegistry
  artifacts: ArtifactStore
  uploads: Uploads
  live: LiveManager
  keepHost?: boolean
  noAgent?: boolean
  /** Home page and direct overlay injection, no reverse proxy. */
  bookmarklet?: boolean
  bookmarkletToken?: string
  /** Forces the home page and the injected dock language. */
  lang?: Lang
  /** Origins allowed to frame the app page; the dock posts quoted elements to them. */
  embedOrigins?: string[]
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function hostname(req: IncomingMessage): string {
  const h = req.headers.host ?? 'localhost'
  const m = /^(\[[^\]]+\]|[^:]+)/.exec(h)
  return m ? m[1] : 'localhost'
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'text/plain; charset=utf-8', extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra })
  res.end(body)
}

function json(res: ServerResponse, data: unknown, status = 200) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8')
}

/** Positive integer query param. Missing uses the default; anything else is invalid. */
function positiveInt(raw: string | null, dflt: number): number | null {
  if (raw === null || raw === '') return dflt
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return n >= 1 ? n : null
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new HttpError(413, 'request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJsonBody<T>(req: IncomingMessage, limit = 1 << 20): Promise<T> {
  const buf = await readBody(req, limit)
  if (!buf.length) return {} as T
  try {
    return JSON.parse(buf.toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'invalid JSON')
  }
}

function serveFile(res: ServerResponse, file: string, extra: Record<string, string> = {}, cache = 'no-cache') {
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'not found')
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  })
  createReadStream(file).pipe(res)
}

export interface Servers {
  app: Server | null
  control: Server
  close(): Promise<void>
}

export async function startServers(o: AppOptions): Promise<Servers> {
  const dir = clientDir()
  const pageDir = path.join(dir, 'page')
  const appDir = path.join(dir, 'app')
  const controlOrigin = (req: IncomingMessage) => o.auth.origin(hostname(req), o.controlPort)
  const appOrigin = (req: IncomingMessage) => o.auth.origin(hostname(req), o.appPort)
  const embedOrigins = o.embedOrigins ?? []
  const proxy = o.target ? createProxy({ target: o.target, cookieName: o.auth.cookieName, controlOrigin, keepHost: o.keepHost, scheme: o.auth.scheme, embedOrigins }) : null

  // ---------- app port ----------
  const pageScripts: Record<string, string> = {
    [OVERLAY_PATH]: 'overlay.js',
    '/__ph/page-control.js': 'page-control.js',
    '/__ph/live-overlay.js': 'live-overlay.js',
  }
  const app = proxy && o.target ? http.createServer((req, res) => {
    try {
      serveApp(req, res)
    } catch (e) {
      log.error('app request failed', e)
      if (!res.headersSent) send(res, 500, 'page-harness: internal error')
      else res.end()
    }
  }) : null
  const serveApp = (req: IncomingMessage, res: ServerResponse) => {
    if (!proxy || !o.target) return send(res, 500, 'page-harness: proxy is not running')
    if (!o.auth.checkHost(req, o.appPort)) return send(res, 421, 'page-harness: unexpected Host header')
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/__ph/embed' && req.method === 'GET') {
      const next = embedNext(url.searchParams.get('next'))
      if (!o.auth.acceptEmbedToken(url.searchParams.get('t') ?? '') || !next) return noAccess(res, 'This preview link is not valid.<br>预览链接无效。')
      o.auth.issueEmbedCookie(res)
      res.writeHead(302, { Location: next, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      return res.end()
    }
    if (!o.auth.allowApp(req)) return noAccess(res, 'Open this page with the invite link from the person running Page Harness.<br>请使用 Page Harness 发起人分享的邀请链接打开。')
    if (url.pathname.startsWith('/__ph/')) {
      if (url.pathname.startsWith(RELAY_PREFIX)) {
        if (!proxy.relay(req, res)) send(res, 403, 'page-harness: relay only reaches subdomains of the target site')
        return
      }
      const file = pageScripts[url.pathname]
      if (!file || req.method !== 'GET') return send(res, 404, 'not found')
      const p = path.join(pageDir, file)
      if (!existsSync(p)) return send(res, 503, `/* page-harness: ${file} missing, run npm run build */`, 'text/javascript')
      let body = readFileSync(p, 'utf8')
      if (file === 'overlay.js') {
        body = `window.__PH_CONFIG=${JSON.stringify({ controlOrigin: controlOrigin(req), appPort: o.appPort, target: o.target.host, relay: proxy.site, ...(o.noAgent ? { noAgent: true } : {}), ...(o.lang ? { lang: o.lang } : {}), ...(embedOrigins.length ? { embed: embedOrigins } : {}) })};\n` + body
      }
      return send(res, 200, body, 'text/javascript; charset=utf-8', { 'Cross-Origin-Resource-Policy': 'same-origin' })
    }
    proxy.handle(req, res)
  }
  if (app && proxy) app.on('upgrade', (req, socket, head) => {
    try {
      const u = req.url ?? ''
      if (!o.auth.checkHost(req, o.appPort) || !o.auth.allowApp(req) || (u.startsWith('/__ph/') && !u.startsWith(RELAY_PREFIX))) return socket.destroy()
      proxy.upgrade(req, socket, head)
    } catch (e) {
      log.error('app upgrade failed', e)
      socket.destroy()
    }
  })

  // ---------- control port ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 << 20 })
  const panelCsp = (req: IncomingMessage, ancestors: string) =>
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' ${o.auth.scheme === 'https' ? 'wss' : 'ws'}://${req.headers.host}`,
      "frame-src 'self' blob: data:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${ancestors}`,
    ].join('; ')

  const noAccess = (res: ServerResponse, text: string) =>
    send(res, 403, `<!doctype html><meta charset="utf-8"><title>Page Harness</title><body style="font:14px/1.6 system-ui,sans-serif;padding:24px;color:#444">${text}</body>`, 'text/html; charset=utf-8', {
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    })

  const servePage = (req: IncomingMessage, res: ServerResponse, page: 'panel' | 'history') => {
    const file = path.join(appDir, `${page}.html`)
    const who = o.auth.issuePageSession(req, res)
    if (!who) return noAccess(res, 'Open this page with the invite link from the person running Page Harness.<br>请使用 Page Harness 发起人分享的邀请链接打开。')
    if (page === 'history' && who.access !== 'owner') return noAccess(res, 'Chat history is only available to the person running Page Harness.<br>对话记录仅发起人可见。')
    if (!existsSync(file)) return send(res, 503, 'page-harness: client build missing, run npm run build')
    const html = readFileSync(file, 'utf8').replace('<html', `<html data-app-origin="${appOrigin(req)}"`)
    send(res, 200, html, 'text/html; charset=utf-8', {
      'Content-Security-Policy': panelCsp(req, page === 'panel' ? [appOrigin(req), ...embedOrigins].join(' ') : "'none'"),
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': page === 'history' ? 'same-origin' : 'unsafe-none',
    })
  }

  const api = createApi(o)

  const control = http.createServer(async (req, res) => {
    try {
      if (!o.auth.checkHost(req, o.controlPort)) return send(res, 421, 'page-harness: unexpected Host header')
      if (!o.auth.allowEmbed(req)) return noAccess(res, 'Open this preview from the embedding page.<br>请从嵌入预览的页面打开。')
      const url = new URL(req.url ?? '/', 'http://x')
      const p = url.pathname
      // Preflight for the bookmarklet's cross-origin reads and writes. `/resolve` is excluded on
      // purpose: it is the local agent's endpoint and no page may reach it (see checkLocalAgent).
      if (req.method === 'OPTIONS' && p !== '/__ph/api/review/resolve' && (p === '/__ph/overlay.js' || p.startsWith('/__ph/api/review'))) {
        bookmarkletCors(req, res)
        res.writeHead(204, { 'Cache-Control': 'no-store' })
        return res.end()
      }
      if (o.bookmarklet && (p === '/' || p === '/__ph' || p === '/__ph/' || p === '/__ph/home') && req.method === 'GET') {
        o.auth.issuePageSession(req, res)
        return send(res, 200, homeHtml({ token: o.bookmarkletToken ?? '', version: packageVersion(), lang: o.lang }), 'text/html; charset=utf-8', {
          'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'no-referrer',
        })
      }
      if (p === '/__ph/home.css' && req.method === 'GET') return send(res, 200, HOME_CSS, 'text/css; charset=utf-8')
      if (p.startsWith('/__ph/home/font/') && req.method === 'GET') {
        const file = homeFontFile(decodeURIComponent(p.slice('/__ph/home/font/'.length)))
        if (!file) return send(res, 404, 'not found')
        return send(res, 200, readFileSync(file), 'font/woff2', { 'Cache-Control': 'public, max-age=86400' })
      }
      if (p === '/__ph/home.js' && req.method === 'GET') return send(res, 200, HOME_JS, 'text/javascript; charset=utf-8')
      if (p === '/__ph/overlay.js' && req.method === 'GET') {
        const file = path.join(pageDir, 'overlay.js')
        if (!existsSync(file)) return send(res, 503, '/* page-harness: overlay.js missing, run npm run build */', 'text/javascript')
        bookmarkletCors(req, res)
        res.setHeader('Access-Control-Allow-Private-Network', 'true')
        return send(res, 200, readFileSync(file), 'text/javascript; charset=utf-8')
      }
      if (p === '/__ph/mcp') {
        if (o.noAgent) return json(res, { error: 'this session has no agent' }, 403)
        const r = o.auth.checkMcp(req)
        if ('error' in r) return json(res, { jsonrpc: '2.0', error: { code: -32001, message: r.error }, id: null }, 401)
        const body = req.method === 'POST' ? await readJsonBody(req, 32 << 20) : undefined
        return await handleMcp(o.gateway.toolHost(), r.scope, req, res, body)
      }
      if (p === '/' || p === '/__ph' || p === '/__ph/') {
        res.writeHead(302, { Location: '/__ph/history' })
        return res.end()
      }
      if (p === '/__ph/join' && req.method === 'GET') {
        const who = o.auth.joinWithInvite(req, res, url.searchParams.get('t') ?? '')
        if (!who) return noAccess(res, 'This invite link is not valid (sharing may be off).<br>邀请链接无效，可能对方已关闭分享。')
        res.writeHead(302, { Location: `${appOrigin(req)}/`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
        return res.end()
      }
      if (p === '/__ph/ui' && req.method === 'GET') return servePage(req, res, 'panel')
      if (p === '/__ph/history' && req.method === 'GET') return servePage(req, res, 'history')
      if (p.startsWith('/__ph/app/') && req.method === 'GET') {
        const rel = decodeURIComponent(p.slice('/__ph/app/'.length))
        const file = path.resolve(appDir, rel)
        if (!file.startsWith(appDir + path.sep) || rel.endsWith('.html')) return send(res, 404, 'not found')
        return serveFile(res, file, {}, rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      }
      if (p.startsWith('/__ph/api/review') && (await serveReviewExtras(o, req, res, url))) return
      if (p.startsWith('/__ph/api/')) {
        const err = o.auth.checkUi(req)
        if (err) return json(res, { error: err }, 403)
        const who = o.auth.identify(req)!
        if (who.access !== 'owner' && !(req.method === 'GET' && url.pathname.startsWith('/__ph/api/artifacts'))) return json(res, { error: 'reviewers cannot use this' }, 403)
        return await api(req, res, url)
      }
      send(res, 404, 'not found')
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof LiveError ? 400 : 500
      if (status === 500) log.error('control request failed', e)
      if (!res.headersSent) json(res, { error: e instanceof Error ? e.message : String(e) }, status)
      else res.end()
    }
  })
  // ask_* tool calls may block for up to 30 minutes.
  control.requestTimeout = 0
  control.headersTimeout = 60_000
  control.keepAliveTimeout = 5_000

  control.on('upgrade', (req, socket, head) => {
    const deny = () => {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
    }
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      if (!o.auth.checkHost(req, o.controlPort) || !o.auth.allowEmbed(req) || url.pathname !== '/__ph/ws' || o.auth.checkWs(req)) return deny()
      const who = o.auth.identify(req)
      if (!who) return deny()
      wss.handleUpgrade(req, socket, head, (ws) => attachClient(ws, who))
    } catch (e) {
      log.error('control upgrade failed', e)
      socket.destroy()
    }
  })

  const attachClient = (ws: WebSocket, who: Who) => {
    const id = newId('ws_')
    const client = {
      id,
      chatId: null as string | null,
      role: 'chat' as 'chat' | 'artifacts' | 'history',
      who,
      send(msg: ServerMsg) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
      },
    }
    o.gateway.connect(client)
    let alive = true
    const ping = setInterval(() => {
      if (!alive) return ws.terminate()
      alive = false
      ws.ping()
    }, 20_000)
    ws.on('pong', () => (alive = true))
    ws.on('message', (data) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(data))
      } catch {
        return client.send({ type: 'error', message: 'bad message' })
      }
      if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return
      o.gateway.handle(client, msg)
    })
    ws.on('close', () => {
      clearInterval(ping)
      o.gateway.disconnect(id)
    })
  }

  if (app) await listen(app, o.appPort, o.host)
  await listen(control, o.controlPort, o.host)

  return {
    app,
    control,
    async close() {
      for (const c of wss.clients) c.terminate()
      const open = app ? [app, control] : [control]
      await Promise.all(open.map((s) => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r())))))
    },
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => {
      reject(e.code === 'EADDRINUSE' ? new Error(`port ${port} is already in use; pick another with --port / --control-port`) : e)
    }
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })
}

// ---------- local review API (no session; paging and resolve only) ----------

/** Cross-origin bookmarklet calls. Reflects Origin only so a public page can reach 127.0.0.1. */
function bookmarkletCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin
  if (typeof origin === 'string' && /^https?:\/\//i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-PH-Token')
  res.setHeader('Access-Control-Max-Age', '600')
}

function requestToken(req: IncomingMessage): string {
  const header = req.headers['x-ph-token']
  return typeof header === 'string' ? header : ''
}

function tokenOk(o: AppOptions, req: IncomingMessage): boolean {
  const token = o.bookmarkletToken
  const got = requestToken(req)
  if (!token || !got) return false
  return safeEqual(got, token)
}

/** A browser Origin that is not this control server. Curl has no Origin. */
function foreignOrigin(o: AppOptions, req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !origin) return false
  return origin !== `${o.auth.scheme}://${req.headers.host}`
}

/** Same-origin and curl may read. A foreign page needs the bookmarklet token, and then CORS. */
function allowForeignRead(o: AppOptions, req: IncomingMessage, res: ServerResponse): boolean {
  if (!foreignOrigin(o, req)) return true
  if (!tokenOk(o, req)) return false
  bookmarkletCors(req, res)
  return true
}

function hostParam(url: URL): string | null {
  const raw = url.searchParams.get('host')
  if (raw === null) return null
  if (raw === '') return ''
  const host = normalizeHost(raw)
  return host || null
}

function siteUrl(host: string): string {
  const name = host.replace(/:\d+$/, '')
  const local = name === 'localhost' || name.endsWith('.localhost') || name === '127.0.0.1' || name === '::1' || name.startsWith('192.168.') || name.startsWith('10.')
  return `${local ? 'http' : 'https'}://${host}`
}

function slimItem(item: ReviewItem) {
  return {
    n: item.n,
    kind: item.kind,
    severity: item.severity,
    status: item.status,
    path: item.path,
    selector: item.selector,
    note: item.note,
    text: item.anchor?.text,
    author: item.author.name,
  }
}

function opMessage(body: { op?: string; draft?: ReviewDraft; id?: string; text?: string; note?: string; status?: string; url?: string; host?: string; look?: ReviewLook }): ClientMsg | null {
  const host = typeof body.host === 'string' ? body.host : undefined
  switch (body.op) {
    case 'add':
      return body.draft ? { type: 'review_add', draft: { ...body.draft, host: body.draft.host || host } } : null
    case 'reply':
      return { type: 'review_reply', id: String(body.id ?? ''), text: String(body.text ?? '') }
    case 'edit':
      return { type: 'review_edit', id: String(body.id ?? ''), note: String(body.note ?? '') }
    case 'status':
      return { type: 'review_status', id: String(body.id ?? ''), status: body.status === 'resolved' ? 'resolved' : 'open' }
    case 'approve':
      return { type: 'review_approve', url: String(body.url ?? '/'), status: body.status === 'approved' || body.status === 'changes' ? body.status : null, host }
    case 'remove':
      return { type: 'review_remove', id: String(body.id ?? '') }
    case 'look':
      return body.look ? { type: 'review_look', id: String(body.id ?? ''), look: body.look } : null
    case 'clear':
      return host ? { type: 'review_clear', host } : null
    default:
      return null
  }
}

/** Local review reads, plus the bookmarklet write API. Returns true when the path was handled. */
async function serveReviewExtras(o: AppOptions, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname
  const m = req.method ?? 'GET'
  if (m === 'GET' && p === '/__ph/api/review') {
    serveReviewPage(o.gateway, res, url)
    return true
  }
  if (m === 'POST' && p === '/__ph/api/review/resolve') {
    const err = o.auth.checkLocalAgent(req)
    if (err) return json(res, { ok: false, error: err }, 403), true
    await serveReviewResolve(o.gateway, req, res)
    return true
  }
  if (m === 'GET' && p === '/__ph/api/review/sites') {
    if (!allowForeignRead(o, req, res)) return json(res, { error: 'missing token' }, 403), true
    json(res, { sites: o.gateway.reviewSites() })
    return true
  }
  if (m === 'GET' && (p === '/__ph/api/review/host' || p === '/__ph/api/review/export.md' || p === '/__ph/api/review/export.json' || p === '/__ph/api/review/prompt' || p === '/__ph/api/review/state')) {
    const host = hostParam(url)
    if (host === null) return json(res, { error: 'host' }, 400), true
    if (p === '/__ph/api/review/state') {
      if (!tokenOk(o, req)) return json(res, { error: 'missing token' }, 403), true
      bookmarkletCors(req, res)
      return json(res, { review: o.gateway.reviewSlice(host), me: o.gateway.ownerMe(), mode: 'review' }), true
    }
    if (!allowForeignRead(o, req, res)) return json(res, { error: 'missing token' }, 403), true
    const slice = o.gateway.reviewSlice(host)
    if (p === '/__ph/api/review/host') return json(res, { host, items: slice.items.map(slimItem) }), true
    const fileHost = (host || 'ungrouped').replace(/[^\w.-]+/g, '_')
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh-CN'
    if (p === '/__ph/api/review/export.md') {
      const md = reviewMarkdown(siteUrl(host), slice.items, slice.approvals, lang)
      return send(res, 200, md, 'text/markdown; charset=utf-8', { 'Content-Disposition': `attachment; filename="review-${fileHost}.md"` }), true
    }
    if (p === '/__ph/api/review/export.json') {
      return send(res, 200, JSON.stringify({ host, items: slice.items, approvals: slice.approvals }, null, 2), 'application/json; charset=utf-8', {
        'Content-Disposition': `attachment; filename="review-${fileHost}.json"`,
      }), true
    }
    const page = siteUrl(host)
    const text = reviewPrompt(slice.items, {
      site: page,
      path: '/',
      url: `${page}/`,
      scope: 'all',
      lang,
      host,
      apiBase: o.auth.origin(hostname(req), o.controlPort),
    })
    return send(res, 200, text, 'text/plain; charset=utf-8'), true
  }
  if (m === 'POST' && p === '/__ph/api/review/op') {
    if (!tokenOk(o, req)) return json(res, { error: 'missing token' }, 403), true
    bookmarkletCors(req, res)
    const body = await readJsonBody<{ op?: string; draft?: ReviewDraft; id?: string; text?: string; note?: string; status?: string; url?: string; host?: string; look?: ReviewLook }>(req, 2 << 20)
    const msg = opMessage(body)
    if (!msg) return json(res, { error: 'bad op' }, 400), true
    o.gateway.runOwnerReview(msg)
    const host = normalizeHost(String(body.host || body.draft?.host || ''))
    return json(res, { review: o.gateway.reviewSlice(host), me: o.gateway.ownerMe(), mode: 'review' }), true
  }
  return false
}

function serveReviewPage(gateway: Gateway, res: ServerResponse, url: URL): void {
  const scope = url.searchParams.get('scope')
  if (scope !== 'here' && scope !== 'all') return json(res, { ok: false, error: 'scope' }, 400)
  const page = positiveInt(url.searchParams.get('page'), 1)
  const pageSize = positiveInt(url.searchParams.get('pageSize'), REVIEW_PAGE_SIZE)
  if (page === null || pageSize === null) return json(res, { ok: false, error: 'page' }, 400)
  const hostRaw = url.searchParams.get('host')
  const host = hostRaw === null ? undefined : hostParam(url)
  if (hostRaw !== null && host === null) return json(res, { ok: false, error: 'host' }, 400)
  json(res, gateway.listReviewPage({ scope, path: url.searchParams.get('path') ?? '/', page, pageSize, host: hostRaw === null ? undefined : host! }))
}

async function serveReviewResolve(gateway: Gateway, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ n?: unknown; result?: unknown }>(req)
  const n = typeof body.n === 'number' ? body.n : typeof body.n === 'string' && /^\d+$/.test(body.n) ? Number(body.n) : NaN
  if (!Number.isInteger(n) || n < 1) return json(res, { ok: false, error: 'unknown' }, 404)
  const result = typeof body.result === 'string' ? body.result : ''
  const out = gateway.resolveReviewN(n, result)
  if (!out) return json(res, { ok: false, error: 'unknown' }, 404)
  json(res, out)
}

// ---------- JSON API ----------

function createApi(o: AppOptions) {
  const { gateway, artifacts, uploads, registry, live } = o
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    const parts = url.pathname.slice('/__ph/api/'.length).split('/').map(decodeURIComponent)
    const m = req.method ?? 'GET'
    const [a, b, c] = parts

    if (a === 'config' && m === 'GET') {
      return json(res, { project: o.project, target: o.target?.href ?? '', agents: registry.list(), defaultAgent: gateway.o.defaultAgent })
    }
    if (a === 'agents') {
      if (!b && m === 'GET') return json(res, registry.list())
      if (b && c === 'models' && m === 'GET') return json(res, await registry.models(b))
    }
    if (a === 'chats') {
      if (!b && m === 'GET') return json(res, gateway.listChats())
      if (!b && m === 'POST') {
        const body = await readJsonBody<{ agent?: string; model?: string }>(req)
        return json(res, gateway.createChat(body.agent, body.model))
      }
      if (b && !c && m === 'GET') {
        const s = gateway.snapshot(b)
        return s ? json(res, s) : json(res, { error: 'not found' }, 404)
      }
      if (b && !c && m === 'PATCH') {
        const body = await readJsonBody<{ title?: string; agent?: string; model?: string | null; effort?: string | null; fast?: boolean }>(req)
        return json(res, gateway.updateChat(b, body))
      }
      if (b && !c && m === 'DELETE') {
        gateway.deleteChat(b)
        return json(res, { ok: true })
      }
      if (b && c === 'turns' && m === 'GET') {
        const r = gateway.page(b, url.searchParams.get('before') ?? undefined, Number(url.searchParams.get('limit') ?? 20))
        return r ? json(res, r) : json(res, { error: 'not found' }, 404)
      }
      if (b && c === 'export.md' && m === 'GET') {
        const md = gateway.exportMarkdown(b)
        if (md === undefined) return json(res, { error: 'not found' }, 404)
        return send(res, 200, md, 'text/markdown; charset=utf-8', { 'Content-Disposition': `attachment; filename="chat-${b}.md"` })
      }
    }
    if (a === 'search' && m === 'GET') {
      return json(res, gateway.search(url.searchParams.get('q') ?? '', url.searchParams.get('chat') ?? undefined))
    }
    if (a === 'artifacts') {
      if (!b && m === 'GET') return json(res, { artifacts: artifacts.list(), pinned: artifacts.pinned })
      if (b && c === 'raw' && m === 'GET') {
        const v = Number(url.searchParams.get('v')) || undefined
        const r = artifacts.read(b, v)
        if (!r) return json(res, { error: 'not found' }, 404)
        const download = url.searchParams.has('download')
        const active = r.info.kind === 'html' || r.info.mime === 'image/svg+xml'
        const headers: Record<string, string> = {}
        // Rendered artifacts run in an opaque origin: no access to the panel, its cookie or the API.
        if (active) headers['Content-Security-Policy'] = "sandbox allow-scripts allow-forms allow-popups allow-modals; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'"
        if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(b)}`
        const type = r.info.kind === 'image' || active ? r.info.mime : r.info.kind === 'file' ? 'application/octet-stream' : 'text/plain; charset=utf-8'
        return send(res, 200, r.data, type.startsWith('text/html') || type === 'text/html' ? 'text/html; charset=utf-8' : type, headers)
      }
      if (b === '_pin' && m === 'POST') {
        const body = await readJsonBody<{ name?: string | null }>(req)
        artifacts.pin(body.name ?? undefined)
        return json(res, { ok: true })
      }
    }
    if (a === 'uploads') {
      if (!b && m === 'POST') {
        const name = url.searchParams.get('name') ?? 'file'
        const mime = url.searchParams.get('mime') ?? req.headers['content-type'] ?? 'application/octet-stream'
        const data = await readBody(req, MAX_UPLOAD_BYTES + 1)
        return json(res, uploads.save(name, String(mime), data))
      }
      if (b && m === 'GET') {
        const p = uploads.path(b)
        if (!p) return json(res, { error: 'not found' }, 404)
        return serveFile(res, p, { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'", 'Content-Disposition': 'inline' })
      }
    }
    if (a === 'live' && m === 'GET') return json(res, live.list())
    json(res, { error: 'not found' }, 404)
  }
}
