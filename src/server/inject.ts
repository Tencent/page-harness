// HTML injection and CSP relaxation for proxied pages. Pure functions so they are easy to test.

export const OVERLAY_PATH = '/__ph/overlay.js'

export interface CspResult {
  csp: string
  /** A nonce our script tag can reuse, when the policy only trusts nonces. */
  nonce?: string
  /** Policies we cannot satisfy by adding sources (e.g. hash-only with strict-dynamic and no nonce). */
  warning?: string
}

const SCRIPT_DIRECTIVES = ['script-src-elem', 'script-src']
const FRAME_DIRECTIVES = ['frame-src', 'child-src']

function parse(csp: string): Array<[string, string[]]> {
  return csp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...values] = d.split(/\s+/)
      return [name.toLowerCase(), values] as [string, string[]]
    })
}

function serialize(dirs: Array<[string, string[]]>): string {
  return dirs.map(([n, v]) => (v.length ? `${n} ${v.join(' ')}` : n)).join('; ')
}

function addSource(values: string[], source: string): string[] {
  const out = values.filter((v) => v !== "'none'")
  if (!out.includes(source)) out.push(source)
  return out
}

/** CSP directive that lets only this page and the configured embedders frame the response. */
export function embedFrameAncestors(embedOrigins: readonly string[]): string {
  return `frame-ancestors 'self' ${embedOrigins.join(' ')}`
}

function setFrameAncestors(dirs: Array<[string, string[]]>, embedOrigins: readonly string[]) {
  const fa = dirs.find(([n]) => n === 'frame-ancestors')
  if (embedOrigins.length) {
    const sources = ["'self'", ...embedOrigins]
    if (fa) fa[1] = sources
    else dirs.push(['frame-ancestors', sources])
    return
  }
  if (fa) fa[1] = addSource(fa[1], "'self'")
}

/** Replaces frame-ancestors with the embed allow-list. Other directives stay as they are. */
export function ensureEmbedFrameAncestors(csp: string, embedOrigins: readonly string[]): string {
  if (!embedOrigins.length) return csp
  const dirs = parse(csp)
  setFrameAncestors(dirs, embedOrigins)
  return serialize(dirs)
}

/**
 * Lets our overlay script load and our panel iframe embed under the page's CSP.
 * `controlOrigin` is the origin serving the panel iframe.
 */
export function relaxCsp(csp: string, controlOrigin: string, embedOrigins: readonly string[] = []): CspResult {
  const dirs = parse(csp)
  const get = (name: string) => dirs.find(([n]) => n === name)
  const defaults = get('default-src')?.[1]
  let nonce: string | undefined
  let warning: string | undefined

  for (const name of SCRIPT_DIRECTIVES) {
    let d = get(name)
    if (!d && name === 'script-src' && defaults) {
      d = [name, [...defaults]]
      dirs.push(d)
    }
    if (!d) continue
    const values = d[1]
    const n = values.map((v) => /^'nonce-([^']+)'$/i.exec(v)?.[1]).find(Boolean)
    if (n) nonce = nonce ?? n
    const strictDynamic = values.includes("'strict-dynamic'")
    if (strictDynamic && !n) {
      warning = 'script-src uses strict-dynamic without a nonce; the overlay may be blocked'
    }
    d[1] = addSource(values, "'self'")
  }

  let framed = false
  for (const name of FRAME_DIRECTIVES) {
    const d = get(name)
    if (d) {
      d[1] = addSource(d[1], controlOrigin)
      framed = true
    }
  }
  if (!framed && defaults) dirs.push(['frame-src', addSource([...defaults], controlOrigin)])

  setFrameAncestors(dirs, embedOrigins)

  return { csp: serialize(dirs), nonce, warning }
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function scriptTag(nonce?: string): string {
  const n = nonce ? ` nonce="${escapeAttr(nonce)}"` : ''
  return `<script src="${OVERLAY_PATH}" data-page-harness${n}></script>`
}

const META_CSP = /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi

/** Rewrites <meta http-equiv="Content-Security-Policy"> tags the same way as the header. */
function relaxMetaCsp(html: string, controlOrigin: string, embedOrigins: readonly string[]): { html: string; nonce?: string } {
  let nonce: string | undefined
  const out = html.replace(META_CSP, (tag) => {
    const m = /content\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)
    if (!m) return tag
    const r = relaxCsp(m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'"), controlOrigin, embedOrigins)
    nonce = nonce ?? r.nonce
    return tag.replace(m[0], `content="${escapeAttr(r.csp)}"`)
  })
  return { html: out, nonce }
}

/**
 * Inserts the overlay script as the very first thing in <head>, so its message
 * listener is registered before any page script runs.
 */
export function injectHtml(html: string, opts: { nonce?: string; controlOrigin: string; embedOrigins?: readonly string[] }): string {
  if (html.includes('data-page-harness')) return html
  const meta = relaxMetaCsp(html, opts.controlOrigin, opts.embedOrigins ?? [])
  html = meta.html
  const tag = scriptTag(opts.nonce ?? meta.nonce)
  const head = /<head\b[^>]*>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
  const root = /<html\b[^>]*>/i.exec(html)
  if (root) return html.slice(0, root.index + root[0].length) + `<head>${tag}</head>` + html.slice(root.index + root[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype) return doctype[0] + tag + html.slice(doctype[0].length)
  return tag + html
}

/** Removes Secure/Domain/SameSite=None from Set-Cookie values so cookies stick on the http proxy origin. */
export function rewriteSetCookie(value: string, secureTarget: boolean): string {
  let parts = value.split(';').map((p) => p.trim())
  parts = parts.filter((p) => !/^domain=/i.test(p))
  if (secureTarget) {
    parts = parts.filter((p) => !/^secure$/i.test(p) && !/^partitioned$/i.test(p))
    parts = parts.map((p) => (/^samesite=none$/i.test(p) ? 'SameSite=Lax' : p))
    if (/^__(secure|host)-/i.test(parts[0])) parts[0] = parts[0].replace(/^__(secure|host)-/i, '')
  }
  return parts.join('; ')
}

/** Removes our own cookie from the Cookie header before forwarding to the target. */
export function stripCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return header
  const kept = header
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(name + '=') && !c.startsWith(name + '_app='))
  return kept.length ? kept.join('; ') : undefined
}
