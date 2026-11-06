// Home page for `page-harness` with no URL: drag the bookmarklet, then open notes by site.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokensCss } from '../../client/shared/tokens'
import type { Lang } from '../shared/protocol'

const require = createRequire(import.meta.url)

/** Latin variable fonts, when the font packages are installed (dev and CI). */
const HOME_FONTS: Record<string, [string, string]> = {
  'inter-latin.woff2': ['@fontsource-variable/inter', 'inter-latin-wght-normal.woff2'],
  'inter-latin-ext.woff2': ['@fontsource-variable/inter', 'inter-latin-ext-wght-normal.woff2'],
  'jetbrains-latin.woff2': ['@fontsource-variable/jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'],
  'jetbrains-latin-ext.woff2': ['@fontsource-variable/jetbrains-mono', 'jetbrains-mono-latin-ext-wght-normal.woff2'],
}

export function homeFontFile(name: string): string | null {
  const spec = HOME_FONTS[name]
  if (!spec) return null
  try {
    const root = path.dirname(require.resolve(`${spec[0]}/package.json`))
    const file = path.join(root, 'files', spec[1])
    return existsSync(file) ? file : null
  } catch {
    return null
  }
}

export function packageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const p of [path.join(here, '..', 'package.json'), path.join(here, '..', '..', 'package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string }
      if (pkg.name === 'page-harness' && pkg.version) return pkg.version
    } catch {}
  }
  return '0.0.0'
}

/** javascript: URL that sets the control config, then loads the overlay from this server. */
export function bookmarkletHref(scriptUrl: string, config: { controlOrigin: string; token: string; lang?: Lang }): string {
  const u = new URL(scriptUrl)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bookmarklet script must be http(s)')
  const cfg = JSON.stringify({
    controlOrigin: config.controlOrigin,
    bookmarklet: true,
    noAgent: true,
    token: config.token,
    ...(config.lang ? { lang: config.lang } : {}),
  }).replace(/</g, '\\u003c')
  const src = JSON.stringify(u.toString()).replace(/</g, '\\u003c')
  return `javascript:(function(){if(window.__phOverlay)return;window.__PH_CONFIG=${cfg};var s=document.createElement('script');s.src=${src};document.documentElement.appendChild(s);})();`
}

const BM = '✦ Page-Harness'
const CMD = 'page-harness <url> --no-agent'

type HelpBit = { readonly k: 't' | 'c'; readonly v: string }

const HOME_COPY = {
  en: {
    title: 'Drag to your bookmarks bar',
    sub: 'Click it on any page to start marking.',
    mine: 'My notes ({n})',
    back: '← Home',
    bar: 'Bookmarks',
    docs: 'Docs',
    gh: 'GitHub',
    trouble: 'Having trouble?',
    helpTitle: 'Bookmark did nothing?',
    help: [
      [
        { k: 't', v: 'HTTPS pages can block requests to 127.0.0.1 on this machine. Use ' },
        { k: 'c', v: CMD },
        { k: 't', v: ' and the proxy will carry them.' },
      ],
      [{ k: 't', v: 'Some sites set a CSP, which stops the page from reaching this machine.' }],
      [{ k: 't', v: 'The bookmark only works for this run. Drag it again after a restart.' }],
    ],
    md: 'Export Markdown',
    json: 'Export JSON',
    copy: 'Copy prompt',
    copied: 'Copied',
    empty: 'No notes for this site yet.',
    none: 'No notes yet.',
    ungrouped: '(ungrouped)',
  },
  'zh-CN': {
    title: '拖到书签栏，就能用',
    sub: '在任何网页上点一下，就能直接标记。',
    mine: '我的标记 ({n})',
    back: '← 首页',
    bar: '书签栏',
    docs: '文档',
    gh: 'GitHub',
    trouble: '遇到问题？',
    helpTitle: '点了书签没反应？',
    help: [
      [
        { k: 't', v: 'HTTPS 网页可能会拦下发往本机 127.0.0.1 的请求，换用 ' },
        { k: 'c', v: CMD },
        { k: 't', v: ' 走代理就行。' },
      ],
      [{ k: 't', v: '有的网站设了 CSP，会禁止页面连本机。' }],
      [{ k: 't', v: '书签只在这次启动期间有效，重新启动后要再拖一次。' }],
    ],
    md: '导出 Markdown',
    json: '导出 JSON',
    copy: '复制 Prompt',
    copied: '已复制',
    empty: '这个网站还没有标记。',
    none: '还没有标记。',
    ungrouped: '（未分组）',
  },
} as const

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function helpInner(lines: readonly (readonly HelpBit[])[]): string {
  return lines
    .map((line) => `<p>· ${line.map((bit) => (bit.k === 'c' ? `<code>${esc(bit.v)}</code>` : esc(bit.v))).join('')}</p>`)
    .join('')
}

export function homeHtml(boot: { token: string; version: string; lang?: Lang }): string {
  const json = JSON.stringify(boot).replace(/</g, '\\u003c')
  const t = HOME_COPY[boot.lang ?? 'en']
  const htmlLang = boot.lang ?? 'en'
  return `<!doctype html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>page-harness</title>
  <link rel="stylesheet" href="/__ph/home.css">
</head>
<body>
  <div class="top">
    <div class="brand"><i></i><span>page-harness</span></div>
    <a class="navl" id="tonotes" href="#notes">${esc(t.mine.replace('{n}', '0'))}</a>
  </div>
  <div class="view on" id="home">
    <div class="hero">
      <div class="bar" id="bar"><span id="bar-label">${esc(t.bar)}</span><span class="chip" id="chip-docs">${esc(t.docs)}</span><span class="chip" id="chip-gh">${esc(t.gh)}</span></div>
      <div class="copy">
        <h1 id="hero-title">${esc(t.title)}</h1>
        <p class="sub" id="hero-sub">${esc(t.sub)}</p>
      </div>
      <a class="bm" id="bm" href="#" draggable="true">${BM}</a>
    </div>
    <button type="button" class="help" id="help">${esc(t.trouble)}</button>
  </div>
  <div class="view" id="notes">
    <div class="notes">
      <div class="side" id="doms"></div>
      <section class="main">
        <div class="mh">
          <h2 id="host-title"></h2>
          <span class="actions">
            <button type="button" class="sb" id="exmd" data-testid="export-md">${esc(t.md)}</button>
            <button type="button" class="sb" id="exjson" data-testid="export-json">${esc(t.json)}</button>
            <button type="button" class="sb p" id="cp" data-testid="copy-prompt">${esc(t.copy)}</button>
          </span>
        </div>
        <div id="list"></div>
      </section>
    </div>
  </div>
  <div class="modal" id="modal">
    <div class="mc" id="modal-card" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <b id="help-title">${esc(t.helpTitle)}</b>
      <div id="help-body">${helpInner(t.help)}</div>
    </div>
  </div>
  <script type="application/json" id="ph-boot">${json}</script>
  <script src="/__ph/home.js"></script>
</body>
</html>`
}

const HOME_FONTS_CSS = `
@font-face { font-family: 'Inter Variable'; font-style: normal; font-display: swap; font-weight: 100 900; src: url(/__ph/home/font/inter-latin-ext.woff2) format('woff2-variations'); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family: 'Inter Variable'; font-style: normal; font-display: swap; font-weight: 100 900; src: url(/__ph/home/font/inter-latin.woff2) format('woff2-variations'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: 'JetBrains Mono Variable'; font-style: normal; font-display: swap; font-weight: 100 800; src: url(/__ph/home/font/jetbrains-latin-ext.woff2) format('woff2-variations'); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family: 'JetBrains Mono Variable'; font-style: normal; font-display: swap; font-weight: 100 800; src: url(/__ph/home/font/jetbrains-latin.woff2) format('woff2-variations'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
`

export const HOME_CSS = `
${tokensCss(':root', ':root[data-theme="dark"]')}
${HOME_FONTS_CSS}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--base); color: var(--fg); font: var(--fs)/1.5 var(--font); -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .45; }
button:focus-visible, a:focus-visible { outline: none; box-shadow: var(--focus); }
.top { position: fixed; z-index: 2; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; align-items: center; padding: 18px 28px; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.brand i { width: 10px; height: 10px; border-radius: 3px; background: var(--accent); transform: rotate(45deg); flex: none; }
.navl { color: var(--fg2); text-decoration: none; font-size: 14px; padding: 6px 12px; border-radius: 8px; }
.navl:hover { background: var(--bg2); color: var(--fg); }
.navl.back { background: var(--bg); border: 1px solid var(--line); color: var(--fg2); box-shadow: var(--shadow-sm); }
.view { display: none; }
.view.on { display: block; }
.hero { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 80px 24px; text-align: center; background: radial-gradient(600px 300px at 50% 42%, var(--accent-soft), transparent 70%); }
.bar { width: min(520px, 100%); height: 40px; border-radius: 10px; background: var(--bg); border: 1px dashed color-mix(in srgb, var(--accent) 28%, var(--line-strong)); display: flex; align-items: center; padding: 0 12px; gap: 8px; color: var(--fg3); font-size: 13px; }
.bar.hot { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.chip { background: var(--bg); border: 1px solid var(--line); border-radius: 7px; padding: 4px 10px; color: var(--fg); font-size: 13px; line-height: 1.2; }
.copy { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.hero h1 { margin: 0; font-size: 30px; letter-spacing: -0.02em; font-weight: 700; line-height: 1.25; }
.sub { margin: 0; color: var(--fg2); font-size: 15px; }
.bm { display: inline-flex; align-items: center; gap: 8px; padding: 14px 26px; border-radius: 12px; background: var(--accent); color: var(--accent-fg); font-weight: 600; font-size: 16px; text-decoration: none; box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 25%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.25); cursor: grab; transition: transform .15s var(--ease); }
.bm:hover { transform: translateY(-2px); }
.bm:active { cursor: grabbing; }
.help { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); border: 0; background: none; font-size: 13px; color: var(--fg3); padding: 4px 8px; }
.help:hover { color: var(--fg2); }
.modal { position: fixed; z-index: 20; inset: 0; background: var(--mask); display: none; align-items: center; justify-content: center; padding: 24px; }
.modal.on { display: flex; }
.mc { background: var(--bg); color: var(--fg2); border-radius: 14px; padding: 22px 24px; width: min(440px, 100%); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.13); font-size: 14px; line-height: 1.6; }
.mc b { display: block; color: var(--fg); margin: 0 0 8px; font-size: 15px; }
.mc p { margin: 0 0 6px; }
.mc code { font-family: var(--mono); font-size: 12px; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
.notes { display: grid; grid-template-columns: 240px 1fr; height: 100vh; padding-top: 64px; }
.side { border-right: 1px solid var(--line); padding: 12px; overflow: auto; }
.site { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 12px; border: 0; border-radius: 8px; background: transparent; text-align: left; font-size: 14px; }
.site:hover { background: var(--bg2); }
.site.on { background: var(--accent-soft); color: var(--accent-hover); }
.site .n { flex: none; color: var(--fg3); font-size: 12px; }
.site.on .n { color: var(--accent); }
.main { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 8px 28px 24px; }
.mh { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0 4px; }
.mh h2 { margin: 0; min-width: 0; font-size: 18px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; flex: none; }
.sb { padding: 7px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); font-size: 13px; white-space: nowrap; }
.sb:hover:not(:disabled) { background: var(--bg2); }
.sb.p { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); font-weight: 600; }
.sb.p:hover:not(:disabled) { background: var(--accent-hover); }
.sb.p.on, .sb.p.on:hover:not(:disabled) { background: var(--ok); border-color: var(--ok); color: #fff; }
#list { flex: 1; overflow: auto; min-height: 0; }
.note { display: flex; gap: 12px; align-items: flex-start; padding: 14px 0; border-bottom: 1px solid var(--line2); }
.pin { flex: none; min-width: 24px; height: 24px; padding: 0 6px; box-sizing: border-box; border-radius: 12px; background: var(--accent); color: var(--accent-fg); font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.say { font-size: 14px; word-break: break-word; }
.q { margin-top: 3px; color: var(--fg3); font-size: 12px; line-height: 1.4; word-break: break-word; }
.empty { color: var(--fg2); font-size: var(--fs-sm); padding: 12px 6px; }
@media (max-width: 800px) {
  .top { padding: 14px 16px; }
  .hero { padding: 88px 16px 80px; }
  .hero h1 { font-size: 26px; }
  .notes { grid-template-columns: 1fr; height: auto; min-height: 100vh; }
  .side { max-height: 40vh; border-right: 0; border-bottom: 1px solid var(--line); }
  .main { padding: 8px 16px 24px; }
  .mh { align-items: flex-start; flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
  .bm:hover { transform: none; }
}
`

export const HOME_JS = `
const boot = JSON.parse(document.getElementById('ph-boot').textContent)
const copy = ${JSON.stringify(HOME_COPY)}
const lang = boot.lang === 'zh-CN' || boot.lang === 'en' ? boot.lang : ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en')
const t = copy[lang]
const BM = '✦ Page-Harness'
document.documentElement.lang = lang
document.title = 'page-harness'
const bm = document.getElementById('bm')
const bar = document.getElementById('bar')
const home = document.getElementById('home')
const notes = document.getElementById('notes')
const tonotes = document.getElementById('tonotes')
const doms = document.getElementById('doms')
const list = document.getElementById('list')
const hostTitle = document.getElementById('host-title')
const exmd = document.getElementById('exmd')
const exjson = document.getElementById('exjson')
const cp = document.getElementById('cp')
const modal = document.getElementById('modal')
const helpTitle = document.getElementById('help-title')
const helpBody = document.getElementById('help-body')

function fillHelp() {
  helpTitle.textContent = t.helpTitle
  helpBody.replaceChildren()
  for (const line of t.help) {
    const p = document.createElement('p')
    p.append('· ')
    for (const bit of line) {
      if (bit.k === 'c') {
        const code = document.createElement('code')
        code.textContent = bit.v
        p.append(code)
      } else p.append(bit.v)
    }
    helpBody.append(p)
  }
}
function applyCopy() {
  document.getElementById('hero-title').textContent = t.title
  document.getElementById('hero-sub').textContent = t.sub
  document.getElementById('bar-label').textContent = t.bar
  document.getElementById('chip-docs').textContent = t.docs
  document.getElementById('chip-gh').textContent = t.gh
  document.getElementById('help').textContent = t.trouble
  bm.textContent = BM
  exmd.textContent = t.md
  exjson.textContent = t.json
  cp.textContent = t.copy
  fillHelp()
}
function bookmarklet() {
  const cfgObj = { controlOrigin: location.origin, bookmarklet: true, noAgent: true, token: boot.token }
  if (boot.lang) cfgObj.lang = boot.lang
  const cfg = JSON.stringify(cfgObj).replace(/</g, '\\\\u003c')
  const srcUrl = JSON.stringify(location.origin + '/__ph/overlay.js').replace(/</g, '\\\\u003c')
  return 'javascript:(function(){if(window.__phOverlay)return;window.__PH_CONFIG=' + cfg + ';var s=document.createElement(\\'script\\');s.src=' + srcUrl + ';document.documentElement.appendChild(s);})();'
}
bm.href = bookmarklet()
applyCopy()

let sites = []
let cur = ''
let total = 0
let ready = false
function label(host) { return host || t.ungrouped }
function notesOpen() { return location.hash === '#notes' }
function applyView() {
  const on = notesOpen()
  home.classList.toggle('on', !on)
  notes.classList.toggle('on', on)
  tonotes.textContent = on ? t.back : t.mine.replace('{n}', String(total))
  tonotes.href = on ? '#' : '#notes'
  tonotes.classList.toggle('back', on)
}
function setExport(on) { exmd.disabled = exjson.disabled = cp.disabled = !on }
async function loadSites() {
  const r = await fetch('/__ph/api/review/sites', { headers: { Accept: 'application/json' } })
  const data = await r.json()
  sites = data.sites || []
  total = sites.reduce((n, s) => n + (Number(s.total) || 0), 0)
  if (!sites.some((s) => s.host === cur)) cur = sites[0] ? sites[0].host : ''
  ready = true
  applyView()
  renderSites()
  if (notesOpen()) await renderNotes()
}
function renderSites() {
  doms.replaceChildren()
  if (!sites.length) {
    const e = document.createElement('div')
    e.className = 'empty'
    e.textContent = t.none
    doms.append(e)
    return
  }
  for (const s of sites) {
    const e = document.createElement('button')
    e.type = 'button'
    e.className = 'site' + (s.host === cur ? ' on' : '')
    e.dataset.testid = 'domain'
    e.dataset.host = s.host
    const name = document.createElement('span')
    name.textContent = label(s.host)
    const n = document.createElement('span')
    n.className = 'n'
    n.textContent = String(s.total)
    e.append(name, n)
    e.addEventListener('click', () => { cur = s.host; renderSites(); void renderNotes() })
    doms.append(e)
  }
}
async function renderNotes() {
  const has = sites.some((s) => s.host === cur)
  hostTitle.textContent = has ? label(cur) : ''
  setExport(has)
  list.replaceChildren()
  if (!has) {
    const e = document.createElement('div')
    e.className = 'empty'
    e.textContent = t.none
    list.append(e)
    return
  }
  const r = await fetch('/__ph/api/review/host?host=' + encodeURIComponent(cur), { headers: { Accept: 'application/json' } })
  const data = await r.json()
  list.replaceChildren()
  const items = data.items || []
  if (!items.length) {
    const e = document.createElement('div')
    e.className = 'empty'
    e.textContent = t.empty
    list.append(e)
    return
  }
  for (const item of items) {
    const e = document.createElement('div')
    e.className = 'note'
    e.dataset.testid = 'note'
    const pin = document.createElement('span')
    pin.className = 'pin'
    pin.textContent = String(item.n || '')
    const col = document.createElement('div')
    const body = document.createElement('div')
    body.className = 'say'
    body.textContent = item.note || ''
    const meta = document.createElement('div')
    meta.className = 'q'
    const quote = item.text ? '“' + item.text + '”' : (item.selector || '')
    meta.textContent = [quote, item.path].filter(Boolean).join(' · ')
    if (item.selector) meta.title = item.selector
    col.append(body, meta)
    e.append(pin, col)
    list.append(e)
  }
}
function download(kind) {
  if (!sites.some((s) => s.host === cur)) return
  const a = document.createElement('a')
  a.href = '/__ph/api/review/export.' + kind + '?host=' + encodeURIComponent(cur) + '&lang=' + encodeURIComponent(lang)
  a.download = ''
  a.click()
}
exmd.addEventListener('click', () => download('md'))
exjson.addEventListener('click', () => download('json'))
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {}
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  document.body.append(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch {}
  ta.remove()
  return ok
}
cp.addEventListener('click', async () => {
  if (cp.disabled) return
  const r = await fetch('/__ph/api/review/prompt?host=' + encodeURIComponent(cur) + '&lang=' + encodeURIComponent(lang), { headers: { Accept: 'text/plain' } })
  const text = await r.text()
  if (!(await writeClipboard(text))) return
  cp.textContent = t.copied
  cp.classList.add('on')
  setTimeout(() => { cp.textContent = t.copy; cp.classList.remove('on') }, 1500)
})
bm.addEventListener('dragstart', () => bar.classList.add('hot'))
bm.addEventListener('dragend', () => bar.classList.remove('hot'))
document.getElementById('help').addEventListener('click', () => modal.classList.add('on'))
modal.addEventListener('click', () => modal.classList.remove('on'))
document.getElementById('modal-card').addEventListener('click', (e) => e.stopPropagation())
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.remove('on') })
window.addEventListener('hashchange', () => { applyView(); if (notesOpen() && ready) void renderNotes() })
applyView()
void loadSites()
`
