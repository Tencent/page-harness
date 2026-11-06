// The review layer on the page: numbered pins for notes, temporary changes applied in place,
// threads, approvals, and the Notes list in the dock. People add notes ("Comment") and changes
// ("Edit") here; the agent adds them through MCP. Changes only affect what reviewers see.
import { normalizeHost, normalizePath } from '@shared/paths'
import type { HarnessMode, Lang, Me, ProbeResult, ReviewDraft, ReviewItem, ReviewLook, ReviewPatch, ReviewState, ToPanel } from '@shared/protocol'
import { authorNotes, liveName, promptEntries, readerEntries, reviewPrompt, type ReaderEntry } from '@shared/review-read'
import { anchorOf, locate } from '../shared/anchor'
import { createPatcher } from '../shared/patcher'
import { clip, inViewport, selectorFor, textOf } from '../shared/dom'
import { markPage, pageBox, pageShot, snapshotLook } from '../shared/snapshot-image'
import { shotElement } from '../shared/snapshot'
import type { pageStrings } from '../shared/i18n-page'

type Strings = ReturnType<typeof pageStrings>

export interface ReviewDeps {
  layer: HTMLElement
  isOwn(el: Element | null): boolean
  send(m: ToPanel): void
  addPick(el: Element): void
  toast(level: 'ok' | 'warn', text: string): void
  strings(): Strings
  lang(): Lang
  openPanel(): void
  /** False in review-only mode: no quote-into-chat. */
  quoting: boolean
  /** When set, Export downloads Markdown instead of writing an artifact. */
  onExport?: () => void
  /** Called when the Notes button or the dock should change. */
  onState(s: { count: number; elsewhere: number; visible: boolean; open: boolean; me: Me | null }): void
}

function siteHost(): string {
  const cfg = window.__PH_CONFIG
  const raw = cfg?.bookmarklet || !cfg?.target ? location.host : cfg.target
  return normalizeHost(raw)
}

const PENDING_KEY = 'ph:rv-open'
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
const here = () => normalizePath(location.href)

/** Port of this run's control origin. The copied prompt uses it instead of assuming page port + 1. */
function controlPortOf(): number | undefined {
  const origin = window.__PH_CONFIG?.controlOrigin
  if (!origin) return undefined
  try {
    const u = new URL(origin)
    const n = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
    return Number.isInteger(n) && n > 0 ? n : undefined
  } catch {
    return undefined
  }
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text !== undefined) el.textContent = text
  return el
}

export function labelOf(el: Element): string {
  const text = typeof getComputedStyle === 'function' ? textOf(el) : (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const alt = el.getAttribute('alt') || el.getAttribute('aria-label') || ''
  const desc = text || alt
  return `${el.tagName.toLowerCase()}${desc ? ` "${clip(desc, 40)}"` : ''}`
}

const rgbToHex = (c: string) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
  return m ? '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('') : '#000000'
}

export function createReview(d: ReviewDeps) {
  let state: ReviewState = { items: [], approvals: [] }
  let mode: HarnessMode = 'source'
  let me: Me | null = null
  let seen: Set<string> | null = null
  const patcher = createPatcher()
  const originalOnly = new Set<string>()
  const located = new Map<string, HTMLElement | null>()
  let showChanges = true
  try {
    showChanges = sessionStorage.getItem('ph:rv-show') !== '0'
  } catch {}
  let listOpen = false
  let tab: 'here' | 'all' = 'here'
  let popId: string | null = null
  let clearArmed = 0
  let removeArmed: { id: string; until: number } | null = null
  let editor: { el: HTMLElement; restore(): void; before?: Promise<{ html: string; image?: string }> } | null = null
  let backfilling = false
  const lookSent = new Set<string>()

  const pins = h('div', 'rv-pins')
  const hl = h('div', 'rv-hl')
  hl.hidden = true
  const pop = h('div', 'rv-pop card')
  pop.hidden = true
  pop.dataset.testid = 'review-pop'
  const list = h('div', 'rv-list card')
  list.hidden = true
  list.dataset.testid = 'review-list'
  const form = h('div', 'rv-form card')
  form.hidden = true
  form.dataset.testid = 'review-form'
  d.layer.append(hl, pins, pop, form, list)

  const items = () => state.items.filter((i) => i.host === siteHost())
  const onPage = (i: ReviewItem) => i.path === here()
  const pageItems = () => items().filter(onPage)
  const read = (list: ReviewItem[]) => readerEntries(list, d.lang())
  const entriesHere = () => read(pageItems())
  const entryById = (id: string) => read(items()).find((e) => e.id === id || e.members.some((m) => m.id === id))
  const person = (name: string) => (name === '匿名' || name === 'Anonymous' ? d.strings().anonymous : name)
  const owner = () => me?.access === 'owner'
  const canDelete = (i: ReviewItem) => owner() || i.author.id === me?.id
  const needName = () => {
    if (me && (me.access === 'owner' || me.name)) return false
    d.toast('warn', d.strings().needName)
    d.openPanel()
    return true
  }

  // ---------- locating ----------
  const find = (i: ReviewItem): HTMLElement | null => {
    const shown = patcher.elOf(i.id)
    if (shown) return shown
    const r = locate(i.selector, i.anchor, { isOwn: (el) => d.isOwn(el), altTexts: i.patch?.text !== undefined ? [i.patch.text] : [] })
    const el = r && r.el instanceof HTMLElement ? r.el : null
    located.set(i.id, el)
    return el
  }
  const wanted = (i: ReviewItem) => i.kind === 'patch' && !!i.patch && showChanges && !originalOnly.has(i.id) && onPage(i)

  // ---------- patches ----------
  const syncPatches = () => {
    const ids = new Set(items().filter((i) => i.kind === 'patch').map((i) => i.id))
    patcher.prune((id) => ids.has(id))
    for (const i of items()) {
      if (i.kind !== 'patch' || !i.patch) continue
      if (editor && (patcher.elOf(i.id) ?? find(i)) === editor.el) continue
      if (!wanted(i)) patcher.revert(i.id)
      else patcher.ensure(i.id, i.patch, () => find(i))
    }
  }

  // ---------- pins ----------
  const sevOf = (i: ReviewItem) => (i.kind === 'patch' ? 'patch' : (i.severity ?? 'suggestion'))
  const sevLabel = (i: ReviewItem) => {
    const t = d.strings()
    return i.kind === 'patch' ? t.kindPatch : t[`sev_${i.severity ?? 'suggestion'}` as 'sev_issue']
  }
  const findEntryEl = (e: ReaderEntry): HTMLElement | null => {
    for (const m of [e.primary, ...e.members]) {
      const el = find(m)
      if (el) return shotElement(el)
    }
    return null
  }
  const renderPins = () => {
    const byEl = new Map<HTMLElement, number>()
    pins.replaceChildren()
    for (const e of entriesHere()) {
      const el = findEntryEl(e)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) continue
      const k = byEl.get(el) ?? 0
      byEl.set(el, k + 1)
      const b = h('button', `rv-pin ${sevOf(e.primary)}${e.status === 'resolved' ? ' done' : ''}${popId === e.id ? ' on' : ''}`, String(e.n))
      b.title = `${e.authorName}: ${clip(e.say, 120)}`
      b.dataset.id = e.id
      b.dataset.testid = 'review-pin'
      const small = r.width < 48 || r.height < 28
      const pinW = 28
      const pinH = 22
      let x = small ? r.right - pinW : r.right - 12
      let y = small ? r.top - pinH - 4 : r.top - 10
      if (small && y < 4) {
        x = r.right + 4
        y = r.top
        if (x > innerWidth - pinW - 4) x = r.left - pinW - 4
      }
      x = Math.min(Math.max(x - k * 24, 4), innerWidth - pinW)
      y = Math.min(Math.max(y, 4), innerHeight - pinH)
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) b.hidden = true
      b.style.left = `${x}px`
      b.style.top = `${y}px`
      b.addEventListener('pointerenter', () => showHl(el))
      b.addEventListener('pointerleave', () => showHl(null))
      b.addEventListener('click', (ev) => {
        ev.stopPropagation()
        openPop(popId === e.id ? null : e.id)
      })
      pins.append(b)
    }
    if (popId) placeNear(pop, pins.querySelector<HTMLElement>(`.rv-pin[data-id="${popId}"]`))
  }
  const showHl = (el: Element | null) => {
    if (!el) return void (hl.hidden = true)
    const r = el.getBoundingClientRect()
    if (!el.isConnected || !inViewport(r)) return void (hl.hidden = true)
    Object.assign(hl.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` })
    hl.hidden = false
  }
  const placeNear = (box: HTMLElement, anchor: Element | null) => {
    const w = Math.min(360, innerWidth - 16)
    if (!anchor || (anchor as HTMLElement).hidden) {
      box.style.left = `${Math.max(8, innerWidth - w - 16)}px`
      box.style.top = '16px'
      return
    }
    const r = anchor.getBoundingClientRect()
    const hgt = box.offsetHeight || 200
    box.style.left = `${Math.min(Math.max(8, r.right - w), innerWidth - w - 8)}px`
    const y = r.bottom + 6 + hgt > innerHeight && r.top - hgt - 6 >= 8 ? r.top - hgt - 6 : r.bottom + 6
    // Stays on screen while its element scrolls away, so a half-written note is never lost off the edge.
    box.style.top = `${Math.min(Math.max(8, y), Math.max(8, innerHeight - hgt - 8))}px`
  }

  // ---------- popover ----------
  const button = (cls: string, text: string, fn: () => void) => {
    const b = h('button', `btn sm ${cls}`, text)
    b.type = 'button'
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      fn()
    })
    return b
  }
  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000)
    return m < 1 ? '' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
  }
  const byline = (name: string, kind: 'agent' | 'human', at: number) => {
    const s = h('span', `rv-by ${kind}`)
    s.append(h('b', '', name))
    const a = ago(at)
    if (a) s.append(h('span', 'rv-ago', a))
    return s
  }
  const safeHtml = (html: string) => html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').replace(/\son\w+=(?:"[^"]*"|'[^']*')/gi, '')
  const pane = (cap: string, fillPane: (box: HTMLElement) => void, onZoom?: () => void) => {
    const p = h('div', 'rv-pane')
    p.append(h('div', 'cap', cap))
    const box = h('div', 'rv-shot')
    fillPane(box)
    if (onZoom && box.firstChild) {
      box.classList.add('zoomable')
      box.title = d.strings().zoomTitle
      box.addEventListener('click', (e) => {
        e.stopPropagation()
        onZoom()
      })
    }
    p.append(box)
    return p
  }
  /** Scales the HTML copy to fit the box; the popover may still be hidden, so it measures once laid out. */
  const fitHtml = (box: HTMLElement, inner: HTMLElement, maxScale: number) => {
    const ro = new ResizeObserver(() => {
      if (!inner.isConnected) return ro.disconnect()
      const w = inner.offsetWidth
      const hgt = inner.offsetHeight
      if (!w || !hgt || !box.clientWidth || !box.clientHeight) return
      const s = Math.min(maxScale, box.clientWidth / w, box.clientHeight / hgt)
      inner.style.transform = `translate(-50%, -50%) scale(${s})`
    })
    ro.observe(box)
    ro.observe(inner)
  }
  const fillLook = (box: HTMLElement, image?: string, html?: string, text?: string, maxScale = 1) => {
    if (image) {
      const img = h('img', 'rv-shot-img')
      img.src = image
      img.alt = ''
      box.append(img)
      return
    }
    if (html) {
      const inner = h('div', 'rv-shot-html')
      inner.innerHTML = safeHtml(html)
      box.append(inner)
      fitHtml(box, inner, maxScale)
      return
    }
    if (text) box.append(h('div', 'rv-mini', text))
  }
  let zoom: HTMLElement | null = null
  const closeZoom = () => {
    zoom?.remove()
    zoom = null
  }
  const openZoom = (look: ReviewLook | undefined, beforeText?: string, afterText?: string) => {
    closeZoom()
    const mask = h('div', 'rv-zoom')
    mask.dataset.testid = 'review-zoom'
    mask.addEventListener('click', (e) => {
      e.stopPropagation()
      if (e.target === mask) closeZoom()
    })
    const card = h('div', 'rv-zoom-card card')
    const head = h('div', 'rv-head')
    const pair = h('div', 'rv-pair')
    const t = d.strings()
    const hasPage = !!(look?.beforePage || look?.afterPage)
    const views: [string, boolean][] = [[t.lookWhole, true], [t.lookPart, false]]
    const tabs = views.map(([label, page]) => {
      const b = button('tab', label, () => show(page))
      b.dataset.page = String(page)
      return b
    })
    const show = (page: boolean) => {
      for (const b of tabs) b.classList.toggle('on', b.dataset.page === String(page))
      pair.replaceChildren(
        pane(t.lookBefore, (box) => fillLook(box, page ? look?.beforePage : look?.beforeImage, page ? undefined : look?.beforeHtml, page ? undefined : beforeText, 2)),
        pane(t.lookAfter, (box) => fillLook(box, page ? look?.afterPage : look?.afterImage, page ? undefined : look?.afterHtml, page ? undefined : afterText, 2)),
      )
    }
    head.append(h('b', '', `${t.lookBefore} / ${t.lookAfter}`))
    if (hasPage) head.append(...tabs)
    head.append(h('span', 'sp'), button('x', '×', closeZoom))
    show(hasPage)
    card.append(head, pair)
    mask.append(card)
    d.layer.append(mask)
    zoom = mask
  }
  /** Kept across re-renders: state updates from other reviewers rebuild the popover. */
  let editingId: string | null = null
  let editDraft = ''
  const noteEditor = (itemId: string) => {
    const t = d.strings()
    const box = h('form', 'rv-edit')
    const input = h('textarea', 'rv-input')
    input.rows = 3
    input.value = editDraft
    input.dataset.testid = 'review-edit-input'
    input.addEventListener('input', () => (editDraft = input.value))
    const stop = () => {
      editingId = null
      editDraft = ''
      openPop(popId)
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        stop()
      } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        box.requestSubmit()
      }
    })
    box.addEventListener('submit', (e) => {
      e.preventDefault()
      const note = input.value.trim()
      if (!note) return d.toast('warn', t.noteEmpty)
      d.send({ type: 'ph:review-edit', id: itemId, note })
      stop()
    })
    const row = h('div', 'rv-edit-acts')
    row.append(h('span', 'sp'), button('cancel', t.cancel, stop), button('primary save', t.save, () => box.requestSubmit()))
    box.append(input, row)
    requestAnimationFrame(() => {
      if (!input.isConnected) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
    return box
  }
  const openPop = (id: string | null) => {
    if (id !== popId || !id) editingId = null
    popId = id
    const entry = id ? entryById(id) : undefined
    if (!entry) {
      popId = null
      pop.hidden = true
      renderPins()
      return
    }
    popId = entry.id
    const i = entry.primary
    const t = d.strings()
    const head = h('div', 'rv-head')
    head.append(h('b', '', `#${entry.n}`), h('span', `rv-sev ${sevOf(i)}`, sevLabel(i)))
    if (entry.status === 'resolved') head.append(h('span', 'rv-sev done', t.resolved))
    head.append(h('span', 'sp'), button('x', '×', () => openPop(null)))
    const body = h('div', 'rv-thread')
    const first = h('div', 'rv-msg')
    const live = liveName(entry)
    first.append(byline(person(entry.authorName), i.author.kind, i.createdAt))
    if (live) first.append(h('div', 'rv-by', live))
    const editable = entry.kind === 'note' && canDelete(i)
    if (editable && editingId === entry.id) first.append(noteEditor(i.id))
    else {
      const say = h('p', 'rv-say', entry.say)
      say.dataset.testid = 'review-say'
      first.append(say)
    }
    if (entry.where) {
      const where = h('div', 'rv-meta wrap', entry.where)
      where.dataset.testid = 'review-where'
      first.append(where)
    }
    for (const note of authorNotes(entry)) {
      const written = h('p', 'rv-note', note)
      written.dataset.testid = 'review-note'
      first.append(written)
    }
    const look = i.look
    const textLine = entry.lines.find((l) => l.text)?.text
    const [beforeText, afterText] = textLine?.includes(' → ') ? textLine.split(' → ') : [i.anchor?.text, i.patch?.text]
    if (entry.kind === 'patch') {
      const pair = h('div', 'rv-pair')
      pair.dataset.testid = 'review-pair'
      const zoomIn = () => openZoom(look, beforeText, afterText)
      pair.append(
        pane(t.lookBefore, (box) => fillLook(box, look?.beforePage ?? look?.beforeImage, look?.beforeHtml, beforeText), zoomIn),
        pane(t.lookAfter, (box) => fillLook(box, look?.afterPage ?? look?.afterImage, look?.afterHtml, afterText), zoomIn),
      )
      first.append(pair)
    } else if (i.anchor?.text) first.append(h('div', 'rv-quote', clip(i.anchor.text, 180)))
    if (!findEntryEl(entry) && (look?.beforeHtml || look?.beforeImage || look?.afterHtml || look?.afterImage))
      first.append(h('div', 'rv-meta wrap', t.elementGone))
    body.append(first)
    for (const m of entry.members) {
      for (const r of m.replies) {
        const row = h('div', 'rv-msg reply')
        row.append(byline(person(r.author.name), r.author.kind, r.at), h('div', 'rv-note', r.text))
        body.append(row)
      }
    }
    const tech = h('details', 'rv-tech')
    tech.append(h('summary', '', t.selectorStyle))
    const pre = h('pre', 'rv-tech-body')
    pre.textContent = entry.lines
      .map((l) => [l.selector, l.css, l.text ? `${t.textLabel} ${l.text}` : '', l.image ? `${t.imageLabel} ${l.image}` : ''].filter(Boolean).join('\n'))
      .join('\n\n')
    tech.append(pre)
    const replyBox = h('form', 'rv-reply')
    const input = h('textarea', 'rv-input')
    input.rows = 1
    input.placeholder = t.replyPh
    input.dataset.testid = 'review-reply'
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        replyBox.requestSubmit()
      }
    })
    replyBox.append(input, button('primary send', t.reply, () => replyBox.requestSubmit()))
    replyBox.addEventListener('submit', (e) => {
      e.preventDefault()
      if (!input.value.trim()) {
        d.toast('warn', t.replyEmpty)
        input.focus()
        return
      }
      if (needName()) return
      d.send({ type: 'ph:review-reply', id: i.id, text: input.value.trim() })
      input.value = ''
    })
    const viewingOriginal = !showChanges || entry.members.some((m) => originalOnly.has(m.id))
    const foot = h('div', 'rv-foot')
    foot.append(
      button(`status ${entry.status === 'resolved' ? '' : 'primary-soft'}`, entry.status === 'resolved' ? t.reopen : t.resolve, () => {
        const next = entry.status === 'resolved' ? 'open' : 'resolved'
        for (const m of entry.members) d.send({ type: 'ph:review-status', id: m.id, status: next })
      }),
    )
    if (entry.kind === 'patch')
      foot.append(
        button('toggle', viewingOriginal ? t.viewChange : t.viewOriginal, () => {
          const ids = [...entry.members, ...entry.extras].map((m) => m.id)
          if (!showChanges) {
            showChanges = true
            originalOnly.clear()
          } else if (viewingOriginal) for (const mid of ids) originalOnly.delete(mid)
          else for (const mid of ids) originalOnly.add(mid)
          refresh()
          openPop(entry.id)
        }),
      )
    if (owner() && d.quoting)
      foot.append(
        button('quote', t.quote, () => {
          const el = findEntryEl(entry)
          if (!el) return d.toast('warn', t.notFound)
          d.addPick(el)
        }),
      )
    if (editable && editingId !== entry.id)
      foot.append(
        button('edit', t.edit, () => {
          editingId = entry.id
          editDraft = i.note
          openPop(entry.id)
        }),
      )
    if (entry.members.some((m) => canDelete(m)))
      foot.append(
        button('danger remove', removeArmed?.id === entry.id && Date.now() < removeArmed.until ? t.removeConfirm : t.remove, () => {
          if (!(removeArmed?.id === entry.id && Date.now() < removeArmed.until)) {
            removeArmed = { id: entry.id, until: Date.now() + 3000 }
            openPop(entry.id)
            setTimeout(() => {
              if (popId === entry.id) openPop(entry.id)
            }, 3100)
            return
          }
          removeArmed = null
          for (const m of entry.members) if (canDelete(m)) d.send({ type: 'ph:review-remove', id: m.id })
          openPop(null)
        }),
      )
    pop.replaceChildren(head, body, tech, replyBox, foot)
    pop.hidden = false
    renderPins()
  }

  const draftBase = (el: HTMLElement) => ({ url: location.href, host: siteHost(), selector: selectorFor(el), anchor: anchorOf(el), label: labelOf(el) })
  /** The element the open comment/edit form is about; the form and its highlight follow it on scroll. */
  let formEl: HTMLElement | null = null
  const closeForm = () => {
    editor?.restore()
    editor = null
    formEl = null
    form.hidden = true
    form.replaceChildren()
    showHl(null)
  }
  const formShell = (title: string, el: HTMLElement) => {
    form.replaceChildren()
    const head = h('div', 'rv-head')
    head.append(h('b', '', title), targetLabel(el), h('span', 'sp'), button('x', '×', closeForm))
    form.append(head)
    form.hidden = false
    formEl = el
    showHl(el)
    return form
  }
  /** The element in words: its text (or alt/aria-label), with the tag as a small chip rather than raw `span "…"`. */
  const targetLabel = (el: Element) => {
    const desc = textOf(el) || el.getAttribute('alt') || el.getAttribute('aria-label') || ''
    const box = h('span', 'rv-meta rv-target')
    box.title = selectorFor(el)
    box.append(h('span', 'rv-tag', el.tagName.toLowerCase()))
    if (desc) box.append(h('span', 'rv-desc', clip(desc, 60)))
    return box
  }
  const field = (label: string, input: HTMLElement) => {
    const l = h('label', 'rv-field')
    l.append(h('span', '', label), input)
    return l
  }
  const stop = (el: HTMLElement) => el.addEventListener('keydown', (e) => e.stopPropagation())

  const openComment = (el: HTMLElement) => {
    const t = d.strings()
    closeForm()
    const base = draftBase(el)
    const f = formShell(t.comment, el)
    const note = h('textarea', 'rv-input')
    note.rows = 3
    note.placeholder = t.commentPh
    note.dataset.testid = 'review-comment'
    stop(note)
    const sev = h('select', 'rv-input')
    for (const k of ['issue', 'suggestion', 'info'] as const) {
      const o = h('option', '', t[`sev_${k}`])
      o.value = k
      sev.append(o)
    }
    sev.value = 'suggestion'
    stop(sev)
    const foot = h('div', 'rv-foot')
    foot.append(
      sev,
      h('span', 'sp'),
      button('', t.cancel, closeForm),
      button('primary save', t.save, () => {
        if (!note.value.trim()) {
          d.toast('warn', t.noteEmpty)
          return note.focus()
        }
        const draft: ReviewDraft = { ...base, kind: 'note', note: note.value.trim(), severity: sev.value as ReviewDraft['severity'] }
        d.send({ type: 'ph:review-add', draft })
        closeForm()
      }),
    )
    f.append(note, foot)
    placeNear(form, el)
    note.focus()
  }

  const openEditor = (el: HTMLElement) => {
    const t = d.strings()
    if (mode !== 'review') return d.toast('warn', t.editSourceOnly)
    closeForm()
    // Take over any change already on this element so the editor starts from what is shown.
    patcher.revertOn(el)
    const base = draftBase(el)
    const cs = getComputedStyle(el)
    const textOnly = el.children.length === 0 && !!el.textContent?.trim()
    const isImg = el.tagName === 'IMG'
    const orig = { text: el.textContent ?? '', style: el.getAttribute('style'), src: el.getAttribute('src'), srcset: el.getAttribute('srcset') }
    const touched: Record<string, string> = {}
    // What these properties computed to before any edit, so the change can say old → new.
    const from: Record<string, string> = Object.fromEntries(['color', 'background-color', 'font-size', 'font-weight', 'padding', 'border-radius'].map((k) => [k, cs.getPropertyValue(k)]))
    editor = {
      el,
      before: snapshotLook(el),
      restore() {
        if (orig.style === null) el.removeAttribute('style')
        else el.setAttribute('style', orig.style)
        if (textOnly && el.textContent !== orig.text) el.textContent = orig.text
        if (isImg) {
          if (orig.src === null) el.removeAttribute('src')
          else el.setAttribute('src', orig.src)
          if (orig.srcset !== null) el.setAttribute('srcset', orig.srcset)
        }
        queueMicrotask(refresh)
      },
    }
    const f = formShell(t.edit, el)
    const styleInput = (prop: string, type: 'color' | 'text' | 'number', initial: string, unit = '') => {
      const i = h('input', 'rv-input')
      i.type = type
      i.value = initial
      i.dataset.prop = prop
      stop(i)
      i.addEventListener('input', () => {
        const v = type === 'number' && i.value ? `${i.value}${unit}` : i.value
        touched[prop] = v
        el.style.setProperty(prop, v, 'important')
      })
      return i
    }
    if (textOnly) {
      const txt = h('textarea', 'rv-input')
      txt.rows = 2
      txt.value = orig.text.trim()
      txt.dataset.testid = 'review-edit-text'
      stop(txt)
      txt.addEventListener('input', () => (el.textContent = txt.value))
      f.append(field(t.fieldText, txt))
    } else if (!isImg) f.append(h('div', 'rv-meta wrap', t.textLocked))
    if (isImg) {
      const src = h('input', 'rv-input')
      src.value = orig.src ?? ''
      src.placeholder = 'https://…'
      src.dataset.testid = 'review-edit-src'
      stop(src)
      src.addEventListener('change', () => {
        el.removeAttribute('srcset')
        el.setAttribute('src', src.value)
      })
      f.append(field(t.fieldImage, src))
    }
    const grid = h('div', 'rv-grid')
    grid.append(
      field(t.fieldColor, styleInput('color', 'color', rgbToHex(cs.color))),
      field(t.fieldBg, styleInput('background-color', 'color', rgbToHex(cs.backgroundColor))),
      field(t.fieldSize, styleInput('font-size', 'number', String(parseFloat(cs.fontSize) || ''), 'px')),
    )
    const weight = h('select', 'rv-input')
    for (const w of ['300', '400', '500', '600', '700', '800']) {
      const o = h('option', '', w)
      o.value = w
      weight.append(o)
    }
    weight.value = String(Math.round(Number(cs.fontWeight) / 100) * 100 || 400)
    weight.dataset.prop = 'font-weight'
    stop(weight)
    weight.addEventListener('change', () => {
      touched['font-weight'] = weight.value
      el.style.setProperty('font-weight', weight.value, 'important')
    })
    grid.append(
      field(t.fieldWeight, weight),
      field(t.fieldPadding, styleInput('padding', 'text', cs.padding)),
      field(t.fieldRadius, styleInput('border-radius', 'text', cs.borderRadius)),
    )
    const note = h('textarea', 'rv-input')
    note.rows = 2
    note.placeholder = t.fieldNote
    note.dataset.testid = 'review-edit-note'
    stop(note)
    let saving = false
    const foot = h('div', 'rv-foot')
    foot.append(
      h('span', 'sp'),
      button('', t.cancel, closeForm),
      button('primary save', t.save, () => {
        const patch: ReviewPatch = {}
        if (Object.keys(touched).length) {
          patch.style = { ...touched }
          patch.from = Object.fromEntries(Object.keys(touched).filter((k) => from[k]).map((k) => [k, from[k]]))
        }
        if (textOnly && el.textContent !== orig.text && (el.textContent ?? '').trim() !== orig.text.trim()) patch.text = el.textContent ?? ''
        if (isImg && el.getAttribute('src') !== orig.src) patch.attrs = { src: el.getAttribute('src') ?? '' }
        if (!patch.style && patch.text === undefined && !patch.attrs) return d.toast('warn', t.noChanges)
        const pending = editor
        if (!pending || saving) return
        saving = true
        void (async () => {
          const after = await snapshotLook(el)
          const before = await pending.before
          if (editor !== pending) return
          const look: ReviewLook = { beforeHtml: before?.html, afterHtml: after.html, beforeImage: before?.image, afterImage: after.image }
          d.send({ type: 'ph:review-add', draft: { ...base, kind: 'patch', note: note.value.trim(), patch, look } })
          closeForm()
        })()
      }),
    )
    f.append(grid, note, foot)
    placeNear(form, el)
  }

  // ---------- list ----------
  const approvalsHere = () => state.approvals.filter((a) => a.path === here() && a.host === siteHost())
  let copiedAt = 0
  const writeClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Plain http pages, or no permission: fall back to a hidden textarea.
      const ta = h('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
      d.layer.append(ta)
      ta.select()
      let ok = false
      try {
        ok = document.execCommand('copy')
      } catch {}
      ta.remove()
      return ok
    }
  }
  const copyPrompt = async () => {
    const t = d.strings()
    const text = reviewPrompt(items(), {
      site: location.origin,
      path: here(),
      url: location.href,
      title: document.title,
      scope: tab,
      lang: d.lang(),
      controlPort: controlPortOf(),
      host: siteHost(),
      apiBase: window.__PH_CONFIG?.bookmarklet ? window.__PH_CONFIG.controlOrigin : undefined,
      resolveToken: window.__PH_CONFIG?.resolveToken,
    })
    if (!(await writeClipboard(text))) return d.toast('warn', t.copyFailed)
    copiedAt = Date.now() + 1500
    renderList()
    setTimeout(renderList, 1600)
  }
  const renderList = () => {
    list.hidden = !listOpen
    if (!listOpen) return
    const t = d.strings()
    const head = h('div', 'rv-head')
    head.append(h('b', '', t.reviewTitle), h('span', 'sp'), button('x', '×', () => setList(false)))

    const actions = h('div', 'rv-tools')
    actions.append(h('span', 'rv-meta', t.approveLabel), h('span', 'sp'))
    const mineAp = approvalsHere().find((a) => a.author.id === me?.id)
    const ap = (status: 'approved' | 'changes', label: string) => {
      const b = button(`approve ${status}${mineAp?.status === status ? ' on' : ''}`, label, () => {
        if (needName()) return
        d.send({ type: 'ph:review-approve', url: location.href, host: siteHost(), status: mineAp?.status === status ? null : status })
      })
      b.dataset.testid = `review-${status}`
      return b
    }
    actions.append(ap('approved', t.approve), ap('changes', t.requestChanges))

    const approvals = h('div', 'rv-approvals')
    for (const a of approvalsHere()) approvals.append(h('span', `rv-chip ${a.status}`, fill(a.status === 'approved' ? t.approvedBy : t.changesBy, { name: a.author.name })))

    const tabs = h('div', 'rv-tabs')
    const nHere = entriesHere().length
    const mk = (k: 'here' | 'all', label: string) => {
      const b = button(`tab${tab === k ? ' on' : ''}`, label, () => {
        tab = k
        renderList()
      })
      b.dataset.testid = `review-tab-${k}`
      return b
    }
    tabs.append(mk('here', `${t.tabHere} ${nHere}`), mk('all', `${t.tabAll} ${read(items()).length}`))
    const tog = h('label', 'rv-tog')
    const cb = h('input')
    cb.type = 'checkbox'
    cb.checked = showChanges
    cb.dataset.testid = 'review-show'
    cb.addEventListener('change', () => {
      showChanges = cb.checked
      originalOnly.clear()
      try {
        sessionStorage.setItem('ph:rv-show', showChanges ? '1' : '0')
      } catch {}
      refresh()
    })
    tog.append(cb, document.createTextNode(t.showChanges))
    tabs.append(h('span', 'sp'), tog)

    const rows = h('div', 'rv-rows')
    const shown = read(tab === 'here' ? pageItems() : items())
    if (!shown.length) rows.append(h('div', 'rv-empty', tab === 'here' && items().length ? t.reviewEmptyHere : t.reviewEmpty))
    if (tab === 'here') rows.append(h('div', 'rv-tip', mode === 'review' ? t.reviewHowEdit : t.reviewHow))
    const groups = new Map<string, ReaderEntry[]>()
    for (const e of shown) groups.set(e.path, [...(groups.get(e.path) ?? []), e])
    const order = [...groups.keys()].sort((a, b) => Number(b === here()) - Number(a === here()) || a.localeCompare(b))
    for (const p of order) {
      if (tab === 'all') rows.append(h('div', 'rv-group', p === here() ? `${p} · ${t.tabHere}` : p))
      for (const e of groups.get(p)!) rows.append(row(e))
    }

    const foot = h('div', 'rv-tools')
    const scopeOpts = { path: here(), scope: tab }
    const cp = button(`copy-prompt${copiedAt > Date.now() ? ' on' : ''}`, copiedAt > Date.now() ? t.promptCopied : t.copyPrompt, () => void copyPrompt())
    cp.dataset.testid = 'review-copy-prompt'
    cp.title = t.copyPromptTip
    cp.disabled = !promptEntries(items(), scopeOpts).length
    foot.append(h('span', 'sp'), cp)
    if (owner()) {
      const exp = button('export', t.exportMd, () => (d.onExport ? d.onExport() : d.send({ type: 'ph:review-export' })))
      exp.disabled = !items().length
      const clr = button('danger clear', Date.now() < clearArmed ? t.clearConfirm : t.clearAll, () => {
        if (Date.now() < clearArmed) {
          clearArmed = 0
          d.send({ type: 'ph:review-clear', host: siteHost() })
        } else {
          clearArmed = Date.now() + 3000
          setTimeout(renderList, 3100)
        }
        renderList()
      })
      clr.disabled = !items().length
      foot.append(exp, clr)
    }
    list.replaceChildren(head, actions, ...(approvals.childElementCount ? [approvals] : []), tabs, rows, foot)
  }
  const row = (e: ReaderEntry) => {
    const t = d.strings()
    const r = h('button', `rv-row${e.status === 'resolved' ? ' done' : ''}`)
    r.type = 'button'
    r.dataset.testid = 'review-row'
    const n = h('span', `rv-n ${sevOf(e.primary)}`, String(e.n))
    const body = h('span', 'rv-body')
    body.append(h('span', 'rv-text', e.say))
    const page = onPage(e.primary)
    const missing = page && !findEntryEl(e)
    const bits = [person(e.authorName), sevLabel(e.primary)]
    const live = liveName(e)
    if (live) bits.push(live)
    for (const note of authorNotes(e)) bits.push(note)
    const replies = e.members.reduce((n, m) => n + m.replies.length, 0)
    if (replies) bits.push(replies === 1 ? t.replyOne : fill(t.replies, { n: replies }))
    if (e.status === 'resolved') bits.push(t.resolved)
    if (missing) bits.push(t.detached)
    if (!page) bits.push(`${t.goPage} ${e.path}`)
    const meta = h('span', `rv-meta${missing ? ' warn' : ''}`, bits.join(' · '))
    body.append(meta)
    r.append(n, body)
    r.addEventListener('click', () => {
      if (!page) {
        try {
          sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: e.id, until: Date.now() + 15000 }))
        } catch {}
        location.assign(e.path)
        return
      }
      const el = findEntryEl(e)
      if (!el) {
        d.toast('warn', t.notFound)
        return openPop(e.id)
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setTimeout(() => openPop(e.id), 350)
    })
    return r
  }
  const setList = (open: boolean) => {
    listOpen = open
    renderList()
    state_()
  }
  const state_ = () => {
    const mine = entriesHere().filter((e) => e.status === 'open').length
    const elsewhere = read(items().filter((i) => !onPage(i))).filter((e) => e.status === 'open').length
    d.onState({ count: mine, elsewhere, visible: !!me, open: listOpen, me })
  }

  const backfillLooks = async () => {
    if (backfilling || editor) return
    // Refresh once per view, even when a picture is already stored: an older save can be a blank strip or only the tail of a list.
    const todo = entriesHere().filter((e) => e.kind === 'patch' && !lookSent.has(e.id))
    if (!todo.length) return
    backfilling = true
    // Open Live candidates patch the same elements and load after review changes, so they sit on top.
    // Shots need the real original: undo the top layer first, and put the layers back in the same order.
    // The Live script loads lazily and can arrive mid-way, so check again before every shot.
    let live: typeof window.__phLive
    const revertAll = () => {
      for (const i of items()) if (i.kind === 'patch') patcher.revert(i.id)
    }
    const hideLive = () => {
      if (live || !window.__phLive) return
      live = window.__phLive
      live.eye('down')
      revertAll()
      syncPatches()
    }
    try {
      const done: { e: ReaderEntry; el: HTMLElement; look: ReviewLook }[] = []
      for (const e of todo) {
        const el = findEntryEl(e)
        if (!el) continue
        lookSent.add(e.id)
        hideLive()
        for (const m of e.members) if (m.patch) patcher.ensure(m.id, m.patch, () => find(m))
        const after = await snapshotLook(el)
        hideLive()
        for (const m of e.members) patcher.revert(m.id)
        const before = await snapshotLook(el)
        syncPatches()
        done.push({ e, el, look: { beforeHtml: before.html, afterHtml: after.html, beforeImage: before.image, afterImage: after.image } })
      }
      if (done.length) {
        // One render per state for all entries; each entry gets its own outline on a copy.
        const members = done.flatMap(({ e }) => e.members)
        hideLive()
        for (const m of members) if (m.patch) patcher.ensure(m.id, m.patch, () => find(m))
        const afterBoxes = done.map(({ el }) => pageBox(el))
        const afterShot = pageShot()
        for (const m of members) patcher.revert(m.id)
        const beforeBoxes = done.map(({ el }) => pageBox(el))
        const beforeShot = pageShot()
        syncPatches()
        const [a, b] = await Promise.all([afterShot, beforeShot])
        done.forEach(({ look }, i) => {
          if (a) look.afterPage = markPage(a, afterBoxes[i])
          if (b) look.beforePage = markPage(b, beforeBoxes[i])
        })
      }
      for (const { e, look } of done) {
        if (look.beforeHtml || look.afterHtml || look.beforeImage || look.afterImage || look.beforePage || look.afterPage) d.send({ type: 'ph:review-look', id: e.primary.id, look })
      }
    } finally {
      if (live) {
        revertAll()
        syncPatches()
        live.eye('up')
      }
      backfilling = false
    }
  }
  const openPending = () => {
    let p: { id: string; until: number } | null = null
    try {
      p = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null')
    } catch {}
    if (!p) return
    const drop = () => {
      try {
        sessionStorage.removeItem(PENDING_KEY)
      } catch {}
    }
    if (Date.now() > p.until) return drop()
    const i = items().find((x) => x.id === p!.id)
    if (!i || !onPage(i)) return
    const el = find(i)
    if (!el) return
    drop()
    el.scrollIntoView({ block: 'center' })
    setTimeout(() => openPop(i.id), 200)
  }

  // ---------- refresh loop ----------
  const refresh = () => {
    syncPatches()
    renderPins()
    renderList()
    state_()
    openPending()
  }
  let timer = 0
  const schedule = () => {
    if (timer) return
    timer = window.setTimeout(() => {
      timer = 0
      if (!items().length) return
      const missing = () => pageItems().filter((i) => located.get(i.id) === null).map((i) => i.id).join()
      const before = missing()
      syncPatches()
      renderPins()
      if (listOpen && missing() !== before) renderList()
      if (popId && missing() !== before) openPop(popId)
      openPending()
      void backfillLooks()
    }, 150)
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'src'] })
  let raf = 0
  const reposition = () => {
    if (raf || (!items().length && form.hidden)) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (items().length) renderPins()
      if (!form.hidden && formEl) {
        placeNear(form, formEl)
        showHl(formEl)
      }
    })
  }
  addEventListener('scroll', reposition, { capture: true, passive: true })
  addEventListener('resize', reposition)
  addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return
      if (zoom) closeZoom()
      else if (!form.hidden) closeForm()
      else if (popId) openPop(null)
      else if (listOpen) setList(false)
      else return
      e.stopPropagation()
    },
    true,
  )

  return {
    setState(next: ReviewState, m: HarnessMode, who: Me) {
      mode = m
      const t = d.strings()
      if (seen && me)
        for (const i of next.items) if (!seen.has(i.id) && i.author.id !== who.id) d.toast('ok', fill(t.newFrom, { name: i.author.name, n: i.n }))
      seen = new Set(next.items.map((i) => i.id))
      me = who
      const ids = new Set(next.items.map((i) => i.id))
      for (const id of [...originalOnly]) if (!ids.has(id)) originalOnly.delete(id)
      state = next
      for (const id of [...lookSent]) if (!ids.has(id)) lookSent.delete(id)
      if (popId && !ids.has(popId)) openPop(null)
      refresh()
      if (popId) openPop(popId)
      void backfillLooks()
    },
    /** Re-checks the page after a client-side navigation. */
    navigated() {
      located.clear()
      openPop(null)
      closeForm()
      refresh()
    },
    toggleList() {
      setList(!listOpen)
    },
    relabel() {
      renderList()
      if (popId) openPop(popId)
    },
    /** Comment on an element picked with Pick. */
    comment(el: Element) {
      if (!(el instanceof HTMLElement) || needName()) return
      openPop(null)
      setList(false)
      openComment(el)
    },
    /** Change an element picked with Pick (review mode only). */
    edit(el: Element) {
      if (!(el instanceof HTMLElement) || needName()) return
      openPop(null)
      setList(false)
      openEditor(el)
    },
    canEdit: () => mode === 'review',
    probe(id: string, selector: string) {
      let result: ProbeResult
      try {
        const els = [...document.querySelectorAll(selector)].filter((el) => !d.isOwn(el))
        const first = els[0]
        result = { count: els.length, url: location.href, label: first ? labelOf(first) : undefined, anchor: first ? anchorOf(first) : undefined }
      } catch {
        result = { count: -1, url: location.href }
      }
      d.send({ type: 'ph:probe-result', id, result })
    },
  }
}
