// overlay.js — injected into every proxied HTML page. Renders the dock (Pick / Artifacts / Chat),
// hosts the panel iframes and relays between them and the page over private MessagePorts.
import { normalizeHost } from '@shared/paths'
import { LIVE_VERSION, PAGE_CONTROL_VERSION, type Lang, type LiveSession, type Pick, type Theme, type ToPage, type ToPanel } from '@shared/protocol'
import { followLayout, inViewport, makeWindow, pickOf, placeWindow, selectorFor } from '../shared/dom'
import { defaultLang, pageStrings } from '../shared/i18n-page'
import type { PageHost } from '../shared/page-host'
import { startDirectReview } from './direct'
import { installRelay } from './relay'
import { panelWatchAdvance, panelWatchDelay, panelWatchIdle } from './panel-watch'
import { createReview } from './review'
import { OVERLAY_CSS } from './style'

const ICONS = {
  pick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7 17 2.5-7.5L21 11z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  artifacts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
}

const store = {
  get<T>(s: Storage, k: string, d: T): T {
    try {
      const v = s.getItem(k)
      return v ? (JSON.parse(v) as T) : d
    } catch {
      return d
    }
  },
  set(s: Storage, k: string, v: unknown) {
    try {
      s.setItem(k, JSON.stringify(v))
    } catch {}
  },
}

function tabId(): string {
  let id = store.get<string>(sessionStorage, 'ph:tab', '')
  if (!id) {
    id = Math.random().toString(36).slice(2, 10)
    store.set(sessionStorage, 'ph:tab', id)
  }
  return id
}

function siteHost(): string {
  const cfg = window.__PH_CONFIG
  const raw = cfg?.bookmarklet || !cfg?.target ? location.host : cfg.target
  return normalizeHost(raw)
}

/** Configured parent origins (--embed-origin). */
function embedAllowed(cfg = window.__PH_CONFIG): string[] {
  return cfg?.embed ?? []
}

/** One-level iframe that may be the embedder. Firefox has no ancestorOrigins, so ph:hello confirms the parent. */
function inEmbedFrame(cfg = window.__PH_CONFIG): boolean {
  const allowed = embedAllowed(cfg)
  if (!allowed.length || window.top === window || window.parent !== window.top) return false
  const ancestor = location.ancestorOrigins?.[0]
  if (ancestor !== undefined) return allowed.includes(ancestor)
  return true
}

/** Parent origin already known to be allowed. Empty until ancestorOrigins or ph:hello confirms it. */
function verifiedEmbedParent(cfg = window.__PH_CONFIG): string[] {
  if (!inEmbedFrame(cfg)) return []
  const ancestor = location.ancestorOrigins?.[0]
  if (ancestor !== undefined && embedAllowed(cfg).includes(ancestor)) return [ancestor]
  return []
}

function init() {
  const cfg = window.__PH_CONFIG
  if (!cfg) return
  const noAgent = !!cfg.noAgent || !!cfg.bookmarklet
  const allowedEmbed = embedAllowed(cfg)
  const embeddable = inEmbedFrame(cfg)
  let parents = verifiedEmbedParent(cfg)
  let quoteWait: Pick[] = []
  const canQuote = !noAgent || embeddable
  const deliverQuote = (pick: Pick) => {
    const origin = parents[0]
    if (!origin) {
      quoteWait.push(pick)
      return
    }
    window.parent.postMessage({ source: 'page-harness', type: 'ph:quote', pick }, origin)
  }
  const bookmarklet = !!cfg.bookmarklet
  const controlOrigin = cfg.controlOrigin
  const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce || document.querySelector<HTMLScriptElement>('script[data-page-harness]')?.nonce || ''
  const forcedLang: Lang | null = cfg.lang === 'en' || cfg.lang === 'zh-CN' ? cfg.lang : null
  let lang: Lang = forcedLang ?? defaultLang()
  let t = pageStrings(lang)
  let theme: Theme = (store.get<string>(localStorage, 'ph:theme', '') as Theme) || 'light'
  let tab = tabId()

  // Duplicated tabs inherit sessionStorage; the first one to claim the id keeps it.
  const instance = Math.random().toString(36).slice(2)
  try {
    const bc = new BroadcastChannel('ph-tabs')
    bc.onmessage = (e) => {
      const d = e.data as { type: string; tab: string; from: string }
      if (d.from === instance) return
      if (d.type === 'probe' && d.tab === tab) bc.postMessage({ type: 'taken', tab, from: instance })
      if (d.type === 'taken' && d.tab === tab) {
        tab = Math.random().toString(36).slice(2, 10)
        store.set(sessionStorage, 'ph:tab', tab)
        sendChat({ type: 'ph:attach', ...attachInfo() })
      }
    }
    bc.postMessage({ type: 'probe', tab, from: instance })
  } catch {}

  // ---------- DOM ----------
  const hostEl = document.createElement('page-harness-root')
  hostEl.setAttribute('data-page-harness', '')
  hostEl.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;'
  const root = hostEl.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = OVERLAY_CSS
  root.appendChild(style)
  const ph = document.createElement('div')
  ph.className = 'ph'
  ph.innerHTML = `
    <div class="banner" hidden><span class="dot"></span><span class="txt"></span><button class="stop"></button></div>
    <div class="catcher" hidden></div>
    <div class="hl" hidden><span></span></div>
    <div class="layer"></div>
    <div class="art-mask" hidden>
      <div class="art win">
        <div class="titlebar"><span class="grip">⋮⋮</span><span class="brand"><i></i><span class="at"></span></span><span class="sp"></span>
          <button class="theme"></button><button class="close">${ICONS.x}</button></div>
      </div>
    </div>
    <div class="dock">
      <span class="who" hidden></span>
      <div class="bar">
        <button data-act="pick">${ICONS.pick}<span></span></button>
        <button data-act="eye" hidden>${ICONS.eye}<span></span></button>
        <button data-act="review" hidden>${ICONS.review}<span></span><em class="count" hidden></em></button>
        <button data-act="artifacts">${ICONS.artifacts}<span></span></button>
        <button data-act="chat">${ICONS.chat}<span></span></button>
      </div>
      <div class="toast" hidden></div>
    </div>
    <div class="drawer win" hidden>
      <div class="titlebar"><span class="grip">⋮⋮</span><span class="brand"><i></i><span class="bt"></span></span><span class="sp"></span>
        <button class="theme"></button><button class="collapse">${ICONS.min}</button></div>
    </div>`
  root.appendChild(ph)
  const $ = <T extends HTMLElement>(sel: string) => ph.querySelector(sel) as T
  const banner = $('.banner')
  const catcher = $('.catcher')
  const hl = $('.hl')
  const layer = $('.layer')
  const drawer = $('.drawer')
  const artMask = $('.art-mask')
  const art = $('.art')
  const toastEl = $('.toast')
  const btn = (act: string) => $<HTMLButtonElement>(`.bar button[data-act="${act}"]`)
  if (noAgent) {
    btn('chat').hidden = true
    btn('artifacts').hidden = true
    btn('eye').hidden = true
  }

  let chatFrame: HTMLIFrameElement | null = null
  let panelLoaded = false
  if (!bookmarklet) {
    chatFrame = document.createElement('iframe')
    chatFrame.src = `${controlOrigin}/__ph/ui#chat`
    chatFrame.allow = 'clipboard-read; clipboard-write'
    chatFrame.title = 'Page Harness chat'
    chatFrame.addEventListener('load', () => {
      panelLoaded = true
    })
    drawer.appendChild(chatFrame)
  }
  let artFrame: HTMLIFrameElement | null = null

  // ---------- state ----------
  let chatPort: MessagePort | null = null
  let artPort: MessagePort | null = null
  let ready = bookmarklet
  let panelWatch = panelWatchIdle()
  let panelTimer = 0
  let picking = false
  let busy = false
  let controlOn = false
  let liveOn = false
  let sessions: LiveSession[] = []
  let uiHidden = false
  let reviewer = false

  let directSend: ((m: ToPanel) => void) | null = null
  const sendChat = (m: ToPanel) => chatPort?.postMessage(m)
  const sendAll = (m: ToPanel) => {
    chatPort?.postMessage(m)
    artPort?.postMessage(m)
  }

  let toastTimer = 0
  const toast = (level: 'ok' | 'warn', text: string) => {
    toastEl.className = `toast ${level}`
    toastEl.textContent = text
    toastEl.hidden = false
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2500)
  }

  const applyTheme = () => {
    ph.dataset.theme = theme
    for (const b of ph.querySelectorAll<HTMLButtonElement>('.titlebar .theme')) {
      b.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon
      b.title = t.theme
    }
  }

  const applyLang = () => {
    btn('pick').querySelector('span')!.textContent = t.pick
    btn('eye').querySelector('span')!.textContent = t.eye
    btn('eye').title = t.eyeTip
    btn('artifacts').querySelector('span')!.textContent = t.artifacts
    btn('review').querySelector('span')!.textContent = t.review
    review.relabel()
    btn('chat').querySelector('span')!.textContent = reviewer ? t.reviewer : t.chat
    if (noAgent) {
      const who = $<HTMLElement>('.who')
      who.hidden = false
      who.textContent = `${siteHost()} · ${t.reviewOnly}`
      who.dataset.testid = 'review-host'
      btn('chat').hidden = true
      btn('artifacts').hidden = true
      btn('eye').hidden = true
    }
    $('.bt').textContent = t.brand
    $('.at').textContent = t.artifacts
    $('.collapse').title = t.collapse
    $('.close').title = t.close
    banner.querySelector('.stop')!.textContent = t.stop
    renderButtons()
    renderBanner()
  }

  const renderButtons = () => {
    if (noAgent) {
      const who = $<HTMLElement>('.who')
      who.hidden = false
      who.textContent = !ready && panelWatch.down ? t.sessionDead : `${siteHost()} · ${t.reviewOnly}`
    }
    for (const act of ['pick', 'artifacts', 'chat']) {
      const b = btn(act)
      b.disabled = !ready || (act === 'pick' && busy)
      if (!ready && !(noAgent && panelWatch.down)) b.dataset.tip = panelWatch.down ? t.sessionDead : t.notReady
      else if (act === 'pick' && busy) b.dataset.tip = t.pickBusy
      else delete b.dataset.tip
    }
    btn('pick').classList.toggle('on', picking)
    btn('pick').title = picking ? t.pickTip : ''
    btn('chat').classList.toggle('on', !drawer.hidden)
    btn('artifacts').classList.toggle('on', !artMask.hidden)
  }

  const renderBanner = () => {
    banner.hidden = !controlOn || uiHidden
    banner.classList.toggle('busy', busy)
    banner.querySelector('.txt')!.textContent = busy ? t.bannerBusy : t.bannerOn
  }

  // ---------- windows ----------
  type Rect = { x: number; y: number; w: number; h: number }
  const defaultDrawer = (): Rect => {
    const w = Math.min(440, innerWidth - 32)
    const h = Math.min(680, innerHeight - 96)
    return { x: innerWidth - w - 16, y: innerHeight - h - 68, w, h }
  }
  const drawerState = store.get<{ r?: Rect; open?: boolean }>(localStorage, 'ph:drawer', {})
  makeWindow(drawer, drawer.querySelector('.titlebar')!, {
    minW: 320,
    minH: 240,
    onChange: (r) => store.set(localStorage, 'ph:drawer', { ...store.get(localStorage, 'ph:drawer', {}), r }),
  })
  const setDrawer = (open: boolean) => {
    if (noAgent) open = false
    drawer.hidden = !open
    if (open) placeWindow(drawer, store.get<{ r?: Rect }>(localStorage, 'ph:drawer', {}).r ?? defaultDrawer())
    store.set(localStorage, 'ph:drawer', { ...store.get(localStorage, 'ph:drawer', {}), open })
    renderButtons()
  }

  makeWindow(art, art.querySelector('.titlebar')!, {
    minW: 480,
    minH: 320,
    onChange: (r) => store.set(sessionStorage, 'ph:art', r),
  })
  const setArtifacts = (open: boolean) => {
    if (noAgent) open = false
    if (open && !ready) return
    if (open && !artFrame) {
      artFrame = document.createElement('iframe')
      artFrame.src = `${controlOrigin}/__ph/ui#artifacts`
      artFrame.allow = 'clipboard-read; clipboard-write'
      artFrame.title = 'Page Harness artifacts'
      art.appendChild(artFrame)
    }
    artMask.hidden = !open
    if (open) {
      const w = Math.min(920, innerWidth - 32)
      const h = Math.min(640, innerHeight - 32)
      placeWindow(art, store.get<Rect | null>(sessionStorage, 'ph:art', null) ?? { x: (innerWidth - w) / 2, y: (innerHeight - h) / 2, w, h })
    }
    renderButtons()
  }

  // ---------- pick ----------
  const isOwn = (el: Element | null) => !!el && (el === hostEl || hostEl.contains(el))
  const elementAt = (x: number, y: number): Element | null => {
    for (const el of document.elementsFromPoint(x, y)) if (!isOwn(el) && el !== document.documentElement) return el
    return null
  }
  let hovered: Element | null = null
  const showHl = (el: Element | null) => {
    hovered = el
    if (!el || el === document.body) {
      hl.hidden = true
      return
    }
    hl.querySelector('span')!.textContent = selectorFor(el)
    placeHl()
  }
  /** The highlight is fixed-positioned, so it is re-measured whenever the page scrolls or resizes. */
  const placeHl = () => {
    const el = hovered
    if (!el || el === document.body) return
    const r = el.getBoundingClientRect()
    if (!el.isConnected || !inViewport(r)) return void (hl.hidden = true)
    Object.assign(hl.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` })
    hl.hidden = false
  }
  const pickHint = document.createElement('div')
  pickHint.className = 'pick-hint'
  pickHint.hidden = true
  const pickBar = document.createElement('div')
  pickBar.className = 'pick-actions card'
  pickBar.dataset.testid = 'pick-actions'
  pickBar.hidden = true
  layer.append(pickHint, pickBar)
  let chosen: Element | null = null
  let unfollow: (() => void) | null = null
  const closePickBar = () => {
    pickBar.hidden = true
    pickBar.replaceChildren()
    chosen = null
    unfollow?.()
    unfollow = null
  }
  /** Keeps the action bar under (or above) the picked element; hidden while the element is scrolled away. */
  const placePickBar = () => {
    if (!chosen) return
    const r = chosen.getBoundingClientRect()
    if (!chosen.isConnected || !inViewport(r)) return void (pickBar.style.visibility = 'hidden')
    pickBar.style.visibility = ''
    const w = pickBar.offsetWidth
    const hgt = pickBar.offsetHeight
    const below = r.bottom + 8 + hgt < innerHeight
    const top = below ? Math.max(8, r.bottom + 8) : r.top - hgt - 8 >= 8 ? r.top - hgt - 8 : Math.min(Math.max(8, r.top + 8), innerHeight - hgt - 8)
    pickBar.style.left = `${Math.min(Math.max(8, r.left), innerWidth - w - 8)}px`
    pickBar.style.top = `${top}px`
  }
  const setPicking = (on: boolean) => {
    if (on && (!ready || busy)) return
    picking = on
    catcher.hidden = !on
    pickHint.hidden = !on
    pickHint.textContent = reviewer || noAgent ? t.pickTipReviewer : t.pickTip
    if (!on) {
      closePickBar()
      showHl(null)
    }
    window.__phLive?.setPicking(on && liveOn && !reviewer)
    renderButtons()
  }
  /** What can be done with a picked element: quote it, comment, change it, or ask for Live candidates. */
  const showPickActions = (el: Element) => {
    chosen = el
    showHl(el)
    const act = (id: string, label: string, fn: () => void, cls = '') => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `btn sm ${cls}`
      b.textContent = label
      b.dataset.testid = `pick-${id}`
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        fn()
      })
      return b
    }
    const done = (fn: () => void) => () => {
      setPicking(false)
      fn()
    }
    const buttons: HTMLButtonElement[] = []
    if (!reviewer && canQuote)
      buttons.push(
        act('quote', t.pickQuote, () => {
          addPick(el)
          closePickBar()
          showHl(null)
        }),
      )
    buttons.push(act('comment', t.comment, done(() => review.comment(el)), 'primary-soft'))
    if (review.canEdit()) buttons.push(act('edit', t.edit, done(() => review.edit(el)), 'primary-soft'))
    if (!reviewer && !noAgent && liveOn && window.__phLive) buttons.push(act('live', t.pickLive, () => window.__phLive?.design(el), 'primary'))
    buttons.push(act('close', '×', () => (closePickBar(), showHl(null)), 'x'))
    pickBar.replaceChildren(...buttons)
    pickBar.hidden = false
    placePickBar()
    unfollow?.()
    unfollow = followLayout(() => {
      if (chosen !== el) return
      placeHl()
      placePickBar()
    }, [el])
  }
  // While picking, the hover highlight follows the page as it scrolls.
  followLayout(() => !chosen && placeHl())
  catcher.addEventListener('pointermove', (e) => {
    if (!chosen) showHl(elementAt(e.clientX, e.clientY))
  })
  catcher.addEventListener('pointerdown', (e) => e.preventDefault())
  catcher.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const el = chosen ? elementAt(e.clientX, e.clientY) : (hovered ?? elementAt(e.clientX, e.clientY))
    closePickBar()
    if (!el) return
    if (!reviewer && !noAgent && liveOn && window.__phLive?.onPick(el)) return
    if (e.shiftKey && !reviewer && canQuote) return addPick(el)
    showPickActions(el)
  })
  addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && picking && chosen) {
        e.stopImmediatePropagation()
        closePickBar()
        showHl(null)
      } else if (e.key === 'Escape' && picking) {
        e.stopImmediatePropagation()
        setPicking(false)
      } else if (e.key === 'Escape' && !artMask.hidden) {
        setArtifacts(false)
      }
    },
    true,
  )

  // The embedding parent points at quoted elements (hover a quote card to see it here).
  if (embeddable) {
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    addEventListener('message', (e) => {
      if (e.source !== window.parent || !allowedEmbed.includes(e.origin)) return
      const d = e.data as { source?: string; type?: string; selector?: string | null; scroll?: boolean } | null
      if (!d || d.source !== 'page-harness-host') return
      if (d.type === 'ph:hello') {
        parents = [e.origin]
        const queued = quoteWait
        quoteWait = []
        for (const pick of queued) window.parent.postMessage({ source: 'page-harness', type: 'ph:quote', pick }, e.origin)
        return
      }
      if (d.type !== 'ph:highlight' || !parents.includes(e.origin) || chosen) return
      clearTimeout(flashTimer)
      let el: Element | null
      try {
        el = d.selector ? document.querySelector(d.selector) : null
      } catch {
        el = null
      }
      if (d.scroll && el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      showHl(el)
      if (el && d.scroll) flashTimer = setTimeout(() => showHl(null), 1600)
    })
    followLayout(() => !picking && !chosen && placeHl())
  }

  const QUEUE_KEY = 'ph:picks'
  const addPick = (el: Element) => {
    const pick = pickOf(el)
    if (embeddable) {
      deliverQuote(pick)
      toast('ok', t.picked)
      return
    }
    if (ready && chatPort) {
      sendChat({ type: 'ph:pick', pick })
      toast('ok', t.picked)
      return
    }
    const q = store.get<Pick[]>(sessionStorage, QUEUE_KEY, [])
    if (q.length >= 20) return toast('warn', t.pickLimit)
    q.push(pick)
    store.set(sessionStorage, QUEUE_KEY, q)
    toast('ok', t.pickedQueued)
  }
  const flushPicks = () => {
    const q = store.get<Pick[]>(sessionStorage, QUEUE_KEY, [])
    if (!q.length) return
    for (const pick of q) sendChat({ type: 'ph:pick', pick })
    store.set(sessionStorage, QUEUE_KEY, [])
  }

  // ---------- lazy modules ----------
  const loaded = new Map<string, Promise<boolean>>()
  const loadScript = (src: string): Promise<boolean> => {
    let p = loaded.get(src)
    if (!p) {
      p = new Promise((resolve) => {
        const s = document.createElement('script')
        s.src = src
        if (nonce) s.nonce = nonce
        s.dataset.pageHarness = ''
        s.onload = () => resolve(true)
        s.onerror = () => resolve(false)
        ;(document.head || document.documentElement).appendChild(s)
      })
      loaded.set(src, p)
    }
    return p
  }
  const pageControlVersion = () => (window.__phPageControl?.version === PAGE_CONTROL_VERSION ? PAGE_CONTROL_VERSION : null)
  const liveVersion = () => (window.__phLive?.version === LIVE_VERSION ? LIVE_VERSION : null)
  const caps = () => ({ pageControl: pageControlVersion(), live: liveVersion() })
  const ensurePageControl = async () => {
    if (!window.__phPageControl) await loadScript('/__ph/page-control.js')
    return pageControlVersion() !== null
  }
  const ensureLive = async () => {
    if (!window.__phLive) await loadScript('/__ph/live-overlay.js')
    if (liveVersion() === null) return false
    window.__phLive!.setLang(lang)
    window.__phLive!.setSessions(sessions)
    window.__phLive!.setPicking(picking && liveOn && !reviewer)
    return true
  }

  // ---------- page commands ----------
  let chain: Promise<unknown> = Promise.resolve()
  const running = new Map<string, AbortController>()
  const runCmd = (id: string, cmd: Extract<ToPage, { type: 'ph:cmd' }>['cmd']) => {
    const ac = new AbortController()
    running.set(id, ac)
    chain = chain.then(async () => {
      let result
      if (ac.signal.aborted) result = { ok: false as const, error: 'cancelled' }
      else if (!(await ensurePageControl())) result = { ok: false as const, error: 'page-control script is unavailable or outdated on this page' }
      else {
        try {
          result = await window.__phPageControl!.run(cmd, ac.signal)
        } catch (e) {
          result = { ok: false as const, error: e instanceof Error ? e.message : String(e) }
        }
      }
      running.delete(id)
      sendChat({ type: 'ph:cmd-result', id, result })
    })
  }
  const cancelCmds = (id?: string) => {
    for (const [k, ac] of running) if (!id || k === id) ac.abort()
  }

  // ---------- panel liveness ----------
  // ready stays false until the control iframe completes its handshake, and the dock
  // otherwise says "Panel is loading…" forever. If that document never arrives, the
  // control port is down; if it arrives and still never attaches, reload it.
  const reloadPanel = () => {
    if (!chatFrame) return
    panelLoaded = false
    const base = chatFrame.src.split('#')[0].split('?')[0]
    chatFrame.src = `${base}?r=${Date.now()}#chat`
  }
  const armPanelWatch = () => {
    if (!chatFrame) return
    clearTimeout(panelTimer)
    panelTimer = window.setTimeout(() => {
      if (ready) return
      const step = panelWatchAdvance(panelWatch, panelLoaded)
      panelWatch = step.state
      if (step.downNow) toast('warn', t.sessionDead)
      if (step.reload) reloadPanel()
      renderButtons()
      armPanelWatch()
    }, panelWatchDelay(panelWatch))
  }
  const panelUp = () => {
    panelWatch = panelWatchIdle()
    clearTimeout(panelTimer)
    renderButtons()
  }

  // ---------- panel channel ----------
  const attachInfo = () => ({ tab, url: location.href, title: document.title, lang, theme, caps: caps(), visible: document.visibilityState === 'visible' })

  const onPanelMessage = (role: 'chat' | 'artifacts') => (e: MessageEvent) => {
    const m = e.data as ToPage
    if (!m || typeof m !== 'object') return
    switch (m.type) {
      case 'ph:ready':
        if (role === 'chat') {
          ready = true
          panelUp()
          flushPicks()
          renderButtons()
        }
        break
      case 'ph:theme':
        theme = m.theme
        store.set(localStorage, 'ph:theme', theme)
        applyTheme()
        if (role === 'chat') artPort?.postMessage({ type: 'ph:theme', theme })
        else chatPort?.postMessage({ type: 'ph:theme', theme })
        break
      case 'ph:lang':
        if (forcedLang) break
        lang = m.lang
        t = pageStrings(lang)
        store.set(localStorage, 'ph:lang', lang)
        applyLang()
        window.__phLive?.setLang(lang)
        break
      case 'ph:control':
        if (noAgent) return
        controlOn = m.on
        if (!m.on) cancelCmds()
        renderBanner()
        if (m.on) void ensurePageControl().then(() => sendChat({ type: 'ph:caps', caps: caps() }))
        break
      case 'ph:busy':
        busy = m.busy
        if (busy && picking) setPicking(false)
        renderBanner()
        renderButtons()
        break
      case 'ph:cmd':
        runCmd(m.id, m.cmd)
        break
      case 'ph:cmd-cancel':
        cancelCmds(m.id)
        break
      case 'ph:live-caps':
        if (noAgent) return
        liveOn = m.on
        if (m.on) void ensureLive().then(() => sendChat({ type: 'ph:caps', caps: caps() }))
        else {
          window.__phLive?.setPicking(false)
          window.__phLive?.setSessions([])
        }
        break
      case 'ph:live-sessions':
        sessions = reviewer ? [] : m.sessions
        if (!window.__phLive && (liveOn || sessions.some((s) => s.status !== 'accepted' && s.status !== 'discarded'))) void ensureLive()
        window.__phLive?.setSessions(sessions)
        break
      case 'ph:live-nav':
        window.__phLive?.nav(m.sid, m.current, m.display)
        break
      case 'ph:notice':
        toast(m.level, m.text)
        break
      case 'ph:session-dead':
        toast('warn', t.sessionDead)
        if (role === 'chat' && chatFrame) {
          ready = false
          chatPort?.close()
          chatPort = null
          panelWatch = { down: true, misses: 0 }
          reloadPanel()
          renderButtons()
          armPanelWatch()
        }
        break
      case 'ph:review-items':
        review.setState(m.review, m.mode, m.me)
        break
      case 'ph:probe':
        review.probe(m.id, m.selector)
        break
      case 'ph:open':
        if (noAgent) break
        if (m.what === 'artifacts') setArtifacts(true)
        else if (m.what === 'chat') setDrawer(true)
        else setArtifacts(false)
        break
    }
  }

  // The panel announces itself with a MessagePort; only our own iframes on the control origin count.
  addEventListener(
    'message',
    (e) => {
      if (e.origin !== controlOrigin) return
      const d = e.data as { type?: string; role?: string }
      if (!d || d.type !== 'ph:hello') return
      const port = e.ports[0]
      if (!port) return
      if (chatFrame && e.source === chatFrame.contentWindow && d.role === 'chat') {
        e.stopImmediatePropagation()
        chatPort?.close()
        chatPort = port
        ready = false
        panelLoaded = true
        panelUp()
        armPanelWatch()
        port.onmessage = onPanelMessage('chat')
        port.postMessage({ type: 'ph:attach', ...attachInfo() } satisfies ToPanel)
      } else if (artFrame && e.source === artFrame.contentWindow && d.role === 'artifacts') {
        e.stopImmediatePropagation()
        artPort?.close()
        artPort = port
        port.onmessage = onPanelMessage('artifacts')
        port.postMessage({ type: 'ph:attach', ...attachInfo() } satisfies ToPanel)
      }
    },
    true,
  )

  // ---------- host API for lazy modules ----------
  const host: PageHost = {
    root,
    layer,
    hostEl,
    send: (m) => sendChat(m),
    toast,
    lang: () => lang,
    theme: () => theme,
    setUiHidden(hidden) {
      uiHidden = hidden
      ph.style.visibility = hidden ? 'hidden' : ''
      renderBanner()
    },
    setEye(visible) {
      if (noAgent) return
      btn('eye').hidden = !visible
    },
    setPicking,
    isOwn,
    patchMode: () => review.canEdit(),
  }
  window.__phHost = host

  const review = createReview({
    layer,
    isOwn,
    send: (m) => (directSend ? directSend(m) : sendChat(m)),
    addPick: (el) => {
      addPick(el)
    },
    toast,
    strings: () => t,
    lang: () => lang,
    openPanel: () => {
      if (!noAgent) setDrawer(true)
    },
    quoting: canQuote,
    onExport: noAgent
      ? () => {
          const url = `${controlOrigin}/__ph/api/review/export.md?host=${encodeURIComponent(siteHost())}&lang=${lang}`
          if (bookmarklet && cfg.token) {
            void fetch(url, { headers: { Accept: 'text/markdown', 'X-PH-Token': cfg.token } })
              .then(async (r) => {
                if (!r.ok) throw new Error('export failed')
                const blob = await r.blob()
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = `review-${siteHost()}.md`
                a.click()
                URL.revokeObjectURL(a.href)
              })
              .catch(() => toast('warn', t.reviewOffline))
            return
          }
          window.open(url, '_blank', 'noopener')
        }
      : undefined,
    onState: ({ count, elsewhere, visible, open, me }) => {
      const b = btn('review')
      b.hidden = !visible
      b.classList.toggle('on', open)
      b.classList.toggle('elsewhere', !count && elsewhere > 0)
      const c = b.querySelector<HTMLElement>('.count')!
      c.hidden = !count
      c.textContent = String(count)
      reviewer = me?.access === 'reviewer'
      btn('chat').querySelector('span')!.textContent = reviewer ? t.reviewer : t.chat
    },
  })

  // ---------- buttons ----------
  btn('pick').addEventListener('click', () => setPicking(!picking))
  btn('chat').addEventListener('click', () => setDrawer(drawer.hidden === true))
  btn('artifacts').addEventListener('click', () => setArtifacts(artMask.hidden === true))
  btn('review').addEventListener('click', () => review.toggleList())
  let eyeDownAt = 0
  btn('eye').addEventListener('pointerdown', () => {
    eyeDownAt = Date.now()
    window.__phLive?.eye('down')
  })
  btn('eye').addEventListener('pointerup', () => {
    window.__phLive?.eye('up')
    if (Date.now() - eyeDownAt < 250) window.__phLive?.eye('click')
  })
  btn('eye').addEventListener('pointerleave', () => eyeDownAt && window.__phLive?.eye('up'))
  $('.collapse').addEventListener('click', () => setDrawer(false))
  $('.close').addEventListener('click', () => setArtifacts(false))
  artMask.addEventListener('pointerdown', (e) => {
    if (e.target === artMask) setArtifacts(false)
  })
  for (const b of ph.querySelectorAll<HTMLButtonElement>('.titlebar .theme')) {
    b.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark'
      store.set(localStorage, 'ph:theme', theme)
      applyTheme()
      sendAll({ type: 'ph:theme', theme })
    })
  }
  banner.querySelector('.stop')!.addEventListener('click', () => {
    cancelCmds()
    controlOn = false
    renderBanner()
    sendChat({ type: 'ph:control-stop' })
  })

  // ---------- mount, navigation, visibility ----------
  const mount = () => {
    if (!hostEl.isConnected) document.documentElement.appendChild(hostEl)
  }
  mount()
  new MutationObserver(mount).observe(document.documentElement, { childList: true })
  let lastUrl = location.href
  const onNav = () => {
    mount()
    if (location.href === lastUrl) return
    lastUrl = location.href
    sendChat({ type: 'ph:url', url: location.href, title: document.title })
    review.navigated()
  }
  for (const k of ['pushState', 'replaceState'] as const) {
    const orig = history[k]
    history[k] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args)
      queueMicrotask(onNav)
      return r
    } as History['pushState']
  }
  addEventListener('popstate', onNav)
  addEventListener('hashchange', onNav)
  new MutationObserver(() => {
    if (document.title) sendChat({ type: 'ph:url', url: location.href, title: document.title })
  }).observe(document.querySelector('title') ?? document.head ?? document.documentElement, { childList: true, characterData: true, subtree: true })
  document.addEventListener('visibilitychange', () => sendChat({ type: 'ph:visibility', visible: document.visibilityState === 'visible' }))

  applyTheme()
  applyLang()
  armPanelWatch()
  if (drawerState.open && !noAgent) setDrawer(true)
  if (bookmarklet && cfg.token) {
    review.setState({ items: [], approvals: [] }, 'review', { access: 'owner', id: 'owner', name: 'You' })
    let offline = false
    const direct = startDirectReview({
      controlOrigin,
      token: cfg.token,
      host: siteHost(),
      onState(reviewState, me) {
        offline = false
        review.setState(reviewState, 'review', me)
      },
      onError() {
        if (offline) return
        offline = true
        toast('warn', t.reviewOffline)
      },
    })
    directSend = (m) => direct.send(m)
  }
}

installRelay(window.__PH_CONFIG?.target, window.__PH_CONFIG?.relay)

if ((window.top === window || inEmbedFrame()) && !window.__phOverlay) {
  window.__phOverlay = true
  if (document.documentElement) init()
  else document.addEventListener('DOMContentLoaded', init, { once: true })
}
