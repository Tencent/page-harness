// Reverse proxy for the target frontend: injects the overlay into HTML, passes everything else through.
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import type { Duplex } from 'node:stream'
import zlib from 'node:zlib'
import { embedFrameAncestors, ensureEmbedFrameAncestors, injectHtml, relaxCsp, rewriteSetCookie, stripCookie } from './inject'
import { log } from './log'
import { privateHost } from './review'

export interface ProxyOptions {
  target: URL
  cookieName: string
  /** Origin of the panel server as seen by this request's browser. */
  controlOrigin(req: IncomingMessage): string
  /** Keep the browser's Host header instead of the target's. */
  keepHost?: boolean
  /** Scheme browsers use to reach the app port. */
  scheme?: 'http' | 'https'
  /** Origins allowed to frame the proxied page (--embed-origin). */
  embedOrigins?: readonly string[]
}

const HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

export const RELAY_PREFIX = '/__ph/relay/'
const MAX_HTML_BYTES = 20 << 20

const SECOND_LEVEL = /^(com|net|org|gov|edu|co|ac|ne|or)$/

/** Registrable domain of the target (heuristic), whose subdomains the page may call through the relay. */
export function relaySite(target: URL): string | null {
  const host = target.hostname
  if (/^(localhost|\d+\.\d+\.\d+\.\d+)$/i.test(host) || host.startsWith('[') || host.endsWith('.localhost')) return null
  const p = host.split('.')
  if (p.length < 2) return null
  const shared = SHARED_HOSTING.find((s) => host.toLowerCase().endsWith('.' + s))
  if (shared) return p.slice(-(shared.split('.').length + 1)).join('.')
  const n = p.length >= 3 && p[p.length - 1].length === 2 && SECOND_LEVEL.test(p[p.length - 2]) ? 3 : 2
  return p.slice(-n).join('.')
}

/** Domains where every subdomain is a different tenant, so the relay stays on the target's own. */
const SHARED_HOSTING = [
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'onrender.com',
  'fly.dev', 'web.app', 'firebaseapp.com', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 'surge.sh', 'blogspot.com',
]

/** Parses `/__ph/relay/<scheme>/<host>/<path>` into the upstream URL, or null when it is not an allowed sibling. */
export function relayTarget(url: string, site: string | null): URL | null {
  if (!site || !url.startsWith(RELAY_PREFIX)) return null
  const m = /^(https?)\/([^/?#]+)(.*)$/.exec(url.slice(RELAY_PREFIX.length))
  if (!m) return null
  let dest: URL
  try {
    dest = new URL(`${m[1]}://${m[2]}${m[3].startsWith('/') ? m[3] : '/' + m[3]}`)
  } catch {
    return null
  }
  if (dest.username || dest.password) return null
  if (dest.hostname !== site && !dest.hostname.endsWith('.' + site)) return null
  return dest
}

function decompress(body: Buffer, encoding: string): Buffer | null {
  try {
    switch (encoding) {
      case '':
      case 'identity':
        return body
      case 'gzip':
      case 'x-gzip':
        return zlib.gunzipSync(body)
      case 'deflate':
        try {
          return zlib.inflateSync(body)
        } catch {
          return zlib.inflateRawSync(body)
        }
      case 'br':
        return zlib.brotliDecompressSync(body)
      case 'zstd': {
        const z = zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }
        return z.zstdDecompressSync ? z.zstdDecompressSync(body) : null
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

export function createProxy(opts: ProxyOptions) {
  const { target } = opts
  const scheme = opts.scheme ?? 'http'
  const embedOrigins = opts.embedOrigins ?? []
  const appOrigin = (req: IncomingMessage) => `${scheme}://${req.headers.host}`
  const secure = target.protocol === 'https:'
  const agent = secure ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true })
  const warned = new Set<string>()
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i.test(target.hostname) || target.hostname.endsWith('.localhost')

  const site = relaySite(target)
  // Local and LAN dev servers often use self-signed certificates; public sites must verify.
  const verifyTarget = !privateHost(target.hostname)

  function outgoingHeaders(req: IncomingMessage, upgrade = false, relay?: URL): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue
      if (!upgrade && HOP_HEADERS.has(k)) continue
      headers[k] = v
    }
    const from = appOrigin(req)
    if (relay) headers.host = relay.host
    else if (!opts.keepHost) headers.host = target.host
    if (typeof headers.origin === 'string' && headers.origin === from) headers.origin = target.origin
    if (typeof headers.referer === 'string' && headers.referer.startsWith(from)) {
      headers.referer = target.origin + headers.referer.slice(from.length)
    }
    const cookie = stripCookie(req.headers.cookie, opts.cookieName)
    if (cookie) headers.cookie = cookie
    else delete headers.cookie
    if (!upgrade) headers['accept-encoding'] = 'gzip, deflate, br'
    for (const k of Object.keys(headers)) if (k.startsWith('x-forwarded-') || k === 'forwarded') delete headers[k]
    // CDNs and multi-tenant hosts route on X-Forwarded-Host; only local dev servers get to see the proxy origin.
    if (local && !relay) {
      headers['x-forwarded-host'] = req.headers.host ?? ''
      headers['x-forwarded-proto'] = scheme
    }
    return headers
  }

  function rewriteLocation(loc: string, req: IncomingMessage, relay?: URL): string {
    if (loc.startsWith(target.origin)) return appOrigin(req) + loc.slice(target.origin.length)
    if (relay && loc.startsWith(relay.origin)) {
      return `${appOrigin(req)}${RELAY_PREFIX}${relay.protocol.slice(0, -1)}/${relay.host}${loc.slice(relay.origin.length)}`
    }
    return loc
  }

  function responseHeaders(res: IncomingMessage, req: IncomingMessage, html: boolean, relay?: URL): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = {}
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined || HOP_HEADERS.has(k)) continue
      if (k === 'set-cookie') out[k] = (v as string[]).map((c) => rewriteSetCookie(c, scheme === 'http' && (secure || relay?.protocol === 'https:')))
      else if (k === 'location') out[k] = rewriteLocation(String(v), req, relay)
      else if (k === 'strict-transport-security') continue
      else if (k === 'x-frame-options' && embedOrigins.length) continue
      else out[k] = v
    }
    if (embedOrigins.length) {
      const csp = out['content-security-policy']
      if (typeof csp === 'string') out['content-security-policy'] = ensureEmbedFrameAncestors(csp, embedOrigins)
      else if (csp === undefined) out['content-security-policy'] = embedFrameAncestors(embedOrigins)
    }
    if (html) {
      delete out['content-length']
      delete out['content-encoding']
      delete out['content-md5']
    }
    return out
  }

  function errorPage(res: ServerResponse, req: IncomingMessage, err: Error) {
    const body = injectHtml(
      `<!doctype html><html><head><meta charset="utf-8"><title>Page Harness</title></head>` +
        `<body style="font:14px system-ui;padding:48px;color:#444;background:#fafafa">` +
        `<h2 style="margin:0 0 8px">Waiting for ${escapeHtml(target.origin)}</h2>` +
        `<p>The target is not reachable yet (${escapeHtml(err.message)}). This page retries automatically. ` +
        `You can still open the chat to ask the agent to start it.</p>` +
        `<script>setTimeout(function(){location.reload()},2500)</script></body></html>`,
      { controlOrigin: opts.controlOrigin(req), embedOrigins },
    )
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }

  const relayAgents = { 'https:': new https.Agent({ keepAlive: true }), 'http:': new http.Agent({ keepAlive: true }) }

  function upstreamOf(relay?: URL) {
    const u = relay ?? target
    const tls = u.protocol === 'https:'
    return { client: tls ? https : http, protocol: u.protocol, hostname: u.hostname, port: u.port || (tls ? 443 : 80) }
  }

  /** Same-site requests the overlay reroutes from sibling subdomains (e.g. api.example.com). */
  function relay(req: IncomingMessage, res: ServerResponse): boolean {
    const dest = relayTarget(req.url ?? '', site)
    if (!dest) return false
    handle(req, res, dest)
    return true
  }

  function handle(req: IncomingMessage, res: ServerResponse, relayTo?: URL) {
    const { client, ...where } = upstreamOf(relayTo)
    const upstream = client.request(
      {
        ...where,
        method: req.method,
        path: relayTo ? relayTo.pathname + relayTo.search : req.url,
        headers: outgoingHeaders(req, false, relayTo),
        agent: relayTo ? relayAgents[relayTo.protocol as 'https:' | 'http:'] : agent,
        rejectUnauthorized: relayTo ? true : verifyTarget,
      },
      (up) => {
        const type = String(up.headers['content-type'] ?? '')
        const isHtml =
          !relayTo && /text\/html|application\/xhtml\+xml/i.test(type) && req.method !== 'HEAD' && up.statusCode !== 204 && up.statusCode !== 304
        if (!isHtml) {
          res.writeHead(up.statusCode ?? 502, up.statusMessage, responseHeaders(up, req, false, relayTo))
          up.pipe(res)
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        let passthrough = false
        up.on('data', (c: Buffer) => {
          if (passthrough) return
          chunks.push(c)
          size += c.length
          if (size <= MAX_HTML_BYTES) return
          passthrough = true
          log.warn(`HTML over ${MAX_HTML_BYTES >> 20} MB passed through without the overlay`)
          res.writeHead(up.statusCode ?? 200, up.statusMessage, responseHeaders(up, req, false))
          for (const b of chunks) res.write(b)
          chunks.length = 0
          up.pipe(res)
        })
        up.on('error', (e) => errorPage(res, req, e))
        up.on('end', () => {
          if (passthrough) return
          const raw = Buffer.concat(chunks)
          const encoding = String(up.headers['content-encoding'] ?? '').toLowerCase().trim()
          const body = decompress(raw, encoding)
          const headers = responseHeaders(up, req, body !== null)
          if (body === null) {
            if (!warned.has(encoding)) {
              warned.add(encoding)
              log.warn(`cannot decode content-encoding "${encoding}"; HTML passed through without the overlay`)
            }
            res.writeHead(up.statusCode ?? 200, up.statusMessage, headers)
            res.end(raw)
            return
          }
          const controlOrigin = opts.controlOrigin(req)
          let nonce: string | undefined
          for (const h of ['content-security-policy', 'content-security-policy-report-only']) {
            const v = headers[h]
            if (typeof v !== 'string') continue
            const r = relaxCsp(v, controlOrigin, embedOrigins)
            headers[h] = r.csp
            nonce = nonce ?? r.nonce
            if (r.warning && !warned.has(r.warning)) {
              warned.add(r.warning)
              log.warn(r.warning)
            }
          }
          // latin1 round-trips arbitrary bytes, so non-UTF-8 pages survive untouched.
          let html = body.toString('latin1')
          html = html.split(target.origin).join(appOrigin(req))
          html = injectHtml(html, { nonce, controlOrigin, embedOrigins })
          const out = Buffer.from(html, 'latin1')
          headers['content-length'] = String(out.length)
          res.writeHead(up.statusCode ?? 200, up.statusMessage, headers)
          res.end(out)
        })
      },
    )
    upstream.on('error', (e) => {
      if (!relayTo) return errorPage(res, req, e)
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`page-harness relay: ${e.message}`)
    })
    req.pipe(upstream)
  }

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = req.url ?? ''
    const relayTo = url.startsWith(RELAY_PREFIX) ? relayTarget(url, site) : undefined
    if (relayTo === null) return socket.destroy()
    const { client, ...where } = upstreamOf(relayTo)
    const upstream = client.request({
      ...where,
      method: req.method,
      path: relayTo ? relayTo.pathname + relayTo.search : url,
      headers: outgoingHeaders(req, true, relayTo),
      rejectUnauthorized: relayTo ? true : verifyTarget,
    })
    upstream.on('upgrade', (up, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${up.statusCode} ${up.statusMessage}`]
      for (let i = 0; i < up.rawHeaders.length; i += 2) lines.push(`${up.rawHeaders[i]}: ${up.rawHeaders[i + 1]}`)
      socket.write(lines.join('\r\n') + '\r\n\r\n')
      if (upHead.length) socket.write(upHead)
      if (head.length) upSocket.write(head)
      upSocket.pipe(socket).pipe(upSocket)
      upSocket.on('error', () => socket.destroy())
      socket.on('error', () => upSocket.destroy())
    })
    upstream.on('response', (up) => {
      socket.write(`HTTP/1.1 ${up.statusCode} ${up.statusMessage}\r\nconnection: close\r\n\r\n`)
      socket.destroy()
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  }

  return { handle: (req: IncomingMessage, res: ServerResponse) => handle(req, res), relay, upgrade, site }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}
