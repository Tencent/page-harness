// Internal authentication. Users never log in; every internal channel is still checked:
//   browser (panel / history)  -> ph cookie (HttpOnly, SameSite=Strict) + Origin + Sec-Fetch-Site + X-PH header on writes
//   agent CLI                  -> per-turn Bearer token on /__ph/mcp only, never accepted from browsers
//   every request              -> Host header allow-list (DNS rebinding)
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import type { Access } from '../shared/protocol'
import type { Team } from './team'

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const raw = part.slice(i + 1).trim()
    let v = raw
    try {
      v = decodeURIComponent(raw)
    } catch {}
    out[part.slice(0, i).trim()] = v
  }
  return out
}

export interface AuthOptions {
  /** Address the servers listen on. */
  host: string
  appPort: number
  controlPort: number
  extraHosts?: string[]
  /** Teammates join with an invite link; without it everyone who can reach the panel is the owner. */
  team?: Team
  /** Scheme browsers use to reach both ports, "https" behind a TLS-terminating load balancer. */
  publicScheme?: PublicScheme
  /** Required on non-loopback connections when the preview is embedded and not shared. */
  embedToken?: string
}

export type PublicScheme = 'http' | 'https'

export interface Who {
  access: Access
  /** Reviewer id. */
  id?: string
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function isLoopback(req: IncomingMessage): boolean {
  return LOOPBACK.has(req.socket.remoteAddress ?? '')
}

/** In-app path for the embed redirect. Rejects scheme, host, and protocol-relative targets. */
export function embedNext(raw: string | null): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw, 'http://localhost')
  } catch {
    return null
  }
  if (u.origin !== 'http://localhost') return null
  if (!u.pathname.startsWith('/') || u.pathname.startsWith('//') || u.pathname.includes('\\')) return null
  return u.pathname + u.search + u.hash
}

export class Auth {
  readonly uiSecret = randomToken()
  private mcpTokens = new Map<string, McpScope>()
  readonly cookieName: string
  /** Reviewer pass for the app port, so other machines only see the page through the invite. */
  readonly appCookieName: string
  /** Proves a non-loopback browser exchanged the embed token. Scoped to the host, so both ports see it. */
  readonly embedCookieName: string
  readonly scheme: PublicScheme
  private hostnames: Set<string>

  constructor(private opts: AuthOptions) {
    this.scheme = opts.publicScheme ?? 'http'
    this.cookieName = `__ph_${opts.controlPort}`
    this.appCookieName = `${this.cookieName}_app`
    this.embedCookieName = `__ph_embed_${opts.controlPort}`
    const names = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
    if (opts.host && opts.host !== '0.0.0.0' && opts.host !== '::') names.add(opts.host)
    if (opts.host === '0.0.0.0' || opts.host === '::') {
      names.add(os.hostname().toLowerCase())
      for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list ?? []) names.add(a.family === 'IPv6' ? `[${a.address}]` : a.address)
      }
    }
    for (const h of opts.extraHosts ?? []) names.add(h.toLowerCase())
    this.hostnames = names
  }

  /** Host header must name this machine and the port the request arrived on. */
  checkHost(req: IncomingMessage, port: number): boolean {
    const host = (req.headers.host ?? '').toLowerCase()
    const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host)
    if (!m) return false
    const p = m[2] ? Number(m[2]) : this.scheme === 'https' ? 443 : 80
    return this.hostnames.has(m[1]) && p === port
  }

  /** Origin of a port as the browser sees it. */
  origin(hostname: string, port: number): string {
    return `${this.scheme}://${hostname}:${port}`
  }

  private get secureAttr(): string {
    return this.scheme === 'https' ? '; Secure' : ''
  }

  get sharing(): boolean {
    return !!this.opts.team?.enabled
  }

  private setCookie(res: ServerResponse, value: string): void {
    res.appendHeader('Set-Cookie', `${this.cookieName}=${value}; Path=/__ph; HttpOnly; SameSite=Strict${this.secureAttr}${value === this.uiSecret ? '' : '; Max-Age=31536000'}`)
  }

  /**
   * Called when a panel page is served. Keeps an existing session; otherwise local requests get
   * the owner session, and while sharing other machines get nothing (they need the invite link).
   */
  issuePageSession(req: IncomingMessage, res: ServerResponse): Who | null {
    if (!this.allowEmbed(req)) return null
    const who = this.identify(req)
    if (who) return who
    if (this.sharing && !isLoopback(req)) return null
    this.setCookie(res, this.uiSecret)
    return { access: 'owner' }
  }

  /** Exchanges a valid invite for a reviewer session. */
  joinWithInvite(req: IncomingMessage, res: ServerResponse, invite: string): Who | null {
    const team = this.opts.team
    if (!team?.enabled || !safeEqual(invite, team.invite)) return null
    const cur = this.identify(req)
    if (cur?.access === 'owner') return cur
    const id = cur?.access === 'reviewer' && cur.id ? cur.id : team.join()
    if (id !== cur?.id) this.setCookie(res, team.sign(id))
    res.appendHeader('Set-Cookie', `${this.appCookieName}=${team.sign(id)}; Path=/; HttpOnly; SameSite=Lax${this.secureAttr}; Max-Age=31536000`)
    return { access: 'reviewer', id }
  }

  /** Non-loopback embed previews need the cookie from /__ph/embed. Loopback, including SSH forwards, stays open. */
  allowEmbed(req: IncomingMessage): boolean {
    if (!this.opts.embedToken || isLoopback(req)) return true
    const v = parseCookies(req.headers.cookie)[this.embedCookieName]
    return !!v && safeEqual(v, this.opts.embedToken)
  }

  acceptEmbedToken(token: string): boolean {
    return !!this.opts.embedToken && safeEqual(token, this.opts.embedToken)
  }

  issueEmbedCookie(res: ServerResponse): void {
    if (!this.opts.embedToken) return
    res.appendHeader('Set-Cookie', `${this.embedCookieName}=${this.opts.embedToken}; Path=/; HttpOnly; SameSite=Lax${this.secureAttr}`)
  }

  /** App port: open locally; while sharing, other machines need the pass from the invite link. */
  allowApp(req: IncomingMessage): boolean {
    if (!this.allowEmbed(req)) return false
    if (!this.sharing || isLoopback(req)) return true
    const v = parseCookies(req.headers.cookie)[this.appCookieName]
    return !!v && !!this.opts.team?.verify(v)
  }

  identify(req: IncomingMessage): Who | null {
    const v = parseCookies(req.headers.cookie)[this.cookieName]
    if (!v) return null
    if (safeEqual(v, this.uiSecret)) return { access: 'owner' }
    const id = this.opts.team?.enabled ? this.opts.team.verify(v) : null
    return id ? { access: 'reviewer', id } : null
  }

  private sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin
    return typeof origin === 'string' && origin === `${this.scheme}://${req.headers.host}`
  }

  /** Browser API calls on the control origin. Returns an error string, or null when allowed. */
  checkUi(req: IncomingMessage): string | null {
    if (req.headers.authorization) return 'bearer tokens are not accepted here'
    if (!this.identify(req)) return 'missing session'
    const site = req.headers['sec-fetch-site']
    const write = req.method !== 'GET' && req.method !== 'HEAD'
    if (write) {
      if (!this.sameOrigin(req)) return 'bad origin'
      if (req.headers['x-ph'] !== '1') return 'missing X-PH header'
    } else {
      if (req.headers.origin && !this.sameOrigin(req)) return 'bad origin'
      if (site && site !== 'same-origin' && site !== 'none') return 'cross-site request'
    }
    return null
  }

  /** WebSocket handshakes always carry Origin in browsers. */
  checkWs(req: IncomingMessage): string | null {
    if (!this.identify(req)) return 'missing session'
    if (!this.sameOrigin(req)) return 'bad origin'
    return null
  }

  /** Issues a token scoped to one agent turn; tool calls carrying it act on that chat only. */
  issueMcpToken(scope: McpScope): string {
    const token = randomToken()
    this.mcpTokens.set(token, scope)
    return token
  }

  revokeMcpToken(token: string): void {
    this.mcpTokens.delete(token)
  }

  /**
   * The local review API (`POST /__ph/api/review/resolve`) is the one write a coding agent makes with
   * plain curl, so it can carry neither the session cookie nor a token. Browsers must not reach it:
   * every browser POST carries `Origin`, and a page that could call this would mark the user's notes
   * resolved with no session, no token and no prompt.
   */
  checkLocalAgent(req: IncomingMessage): string | null {
    if (req.headers.origin) return 'browsers may not call the local agent API'
    if (req.headers['sec-fetch-site'] === 'cross-site') return 'cross-site requests are not accepted here'
    if (req.headers.cookie && parseCookies(req.headers.cookie)[this.cookieName]) return 'session cookies are not accepted here'
    return null
  }

  /** MCP endpoint: agent CLIs only. */
  checkMcp(req: IncomingMessage): { scope: McpScope } | { error: string } {
    if (req.headers.origin) return { error: 'browsers may not call the MCP endpoint' }
    if (req.headers.cookie && parseCookies(req.headers.cookie)[this.cookieName]) return { error: 'session cookies are not accepted here' }
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
    if (!m) return { error: 'missing token' }
    const given = m[1].trim()
    for (const [token, scope] of this.mcpTokens) if (safeEqual(given, token)) return { scope }
    return { error: 'invalid or expired token' }
  }
}

export interface McpScope {
  chatId: string
  turnId: string
}
