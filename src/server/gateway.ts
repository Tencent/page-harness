// Chat gateway: many chats, one FIFO queue per chat, every event persisted to an append-only log.
import type { AgentRegistry } from '../agents'
import { LIVE_PATCH_SKILL, LIVE_SKILL, baseInstructions } from '../agents/skills'
import type { AgentEvent, TurnInput } from '../agents/types'
import type {
  AgentInfo,
  AskAnswer,
  ChatEvent,
  ChatEventBody,
  ChatMeta,
  ChatSnapshot,
  ClientMsg,
  HarnessMode,
  LiveRequest,
  LiveSession,
  ModelInfo,
  ReviewLook,
  QueueItem,
  ServerMsg,
  TurnEndStatus,
  TurnView,
  Usage,
  UserMessage,
} from '../shared/protocol'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { applyEvent, buildTurns, turnText } from '../shared/turns'
import { newId, truncate } from '../shared/util'
import type { ArtifactStore } from './artifacts'
import { AskManager } from './asks'
import type { Auth, McpScope } from './auth'
import { LiveError, requestText, type LiveManager, type MarkerGuard } from './live'
import { log } from './log'
import { MCP_SERVER_NAME, type ToolHost } from './mcp'
import type { PageBridge } from './pageBridge'
import { MAX_REVIEW_ITEMS, type ReviewStore } from './review'
import type { Who } from './auth'
import type { Team } from './team'
import { buildPrompt } from './prompt'
import { ChatStore } from './store'
import type { Uploads } from './uploads'

export const PAGE_SIZE = 20
const FLUSH_MS = 250

export interface GatewayOptions {
  project: string
  dataDir: string
  target: string
  appUrl: string
  mcpUrl: string
  registry: AgentRegistry
  defaultAgent: string
  defaultModel?: string
  artifacts: ArtifactStore
  uploads: Uploads
  live: LiveManager
  guard: MarkerGuard
  bridge: PageBridge
  auth: Auth
  mode: HarnessMode
  review: ReviewStore
  team: Team
  /** Invite link printed with --share. */
  shareUrl?: string
  /** Review-only: never start an agent CLI. */
  noAgent?: boolean
}

/** Broadcasts teammates get; chats, Live sessions and page control stay with the owner. */
const REVIEWER_RECEIVES = new Set<ServerMsg['type']>(['review', 'artifacts', 'notice', 'error'])
/** Harmless panel housekeeping a reviewer's panel still sends. */
const REVIEWER_IGNORED = new Set<ClientMsg['type']>(['subscribe', 'ping', 'page_control', 'page_visibility', 'probe_result'])

export interface Client {
  id: string
  chatId: string | null
  role: 'chat' | 'artifacts' | 'history'
  who: Who
  send(msg: ServerMsg): void
}

interface Running {
  turnId: string
  ac: AbortController
  item: QueueItem
}

class Chat {
  meta: ChatMeta
  persisted: boolean
  turns: TurnView[] = []
  queue: QueueItem[] = []
  running: Running | null = null
  seq = 0
  loaded = false
  private pendingDelta: ChatEvent | null = null
  private flushTimer: NodeJS.Timeout | null = null

  constructor(
    private store: ChatStore,
    meta: ChatMeta,
    persisted: boolean,
  ) {
    this.meta = meta
    this.persisted = persisted
  }

  load(): this {
    if (this.loaded) return this
    this.loaded = true
    if (!this.persisted) return this
    const events = this.store.readEvents(this.meta.id)
    this.turns = buildTurns(events)
    this.seq = events.reduce((m, e) => Math.max(m, e.seq), 0)
    this.queue = this.store.loadQueue(this.meta.id)
    for (const t of this.turns) {
      if (t.status === 'running') this.emit(t.id, { t: 'turn_end', status: 'interrupted', durationMs: 0, message: 'Page Harness stopped while this turn was running' })
    }
    return this
  }

  /** Set by deleteChat: a turn still winding down must not write the chat back to disk. */
  deleted = false

  persist(): void {
    if (this.deleted) return
    this.persisted = true
    this.store.saveMeta(this.meta)
  }

  /** Records an event and returns it; text/thinking deltas are coalesced before hitting disk. */
  emit(turnId: string, body: ChatEventBody): ChatEvent {
    const ev = { ...body, chatId: this.meta.id, turnId, seq: ++this.seq, ts: Date.now() } as ChatEvent
    applyEvent(this.turns, ev)
    if (!this.persisted) this.persist()
    if (ev.t === 'text' || ev.t === 'thinking') {
      const p = this.pendingDelta
      if (p && p.t === ev.t && p.turnId === turnId) {
        ;(p as { delta: string }).delta += ev.delta
        p.seq = ev.seq
        p.ts = ev.ts
      } else {
        this.flush()
        this.pendingDelta = { ...ev }
      }
      this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS)
    } else {
      this.flush()
      if (!this.deleted) this.store.append(this.meta.id, ev)
    }
    return ev
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    if (this.pendingDelta && !this.deleted) this.store.append(this.meta.id, this.pendingDelta)
    this.pendingDelta = null
  }

  saveQueue(): void {
    if (this.deleted) return
    if (this.persisted || this.queue.length) {
      if (!this.persisted) this.persist()
      this.store.saveQueue(this.meta.id, this.queue)
    }
  }
}

export interface SearchHit {
  chatId: string
  title: string
  turnId: string
  ts: number
  role: 'user' | 'agent'
  snippet: string
}

export class Gateway {
  readonly store: ChatStore
  readonly asks: AskManager
  private chats = new Map<string, Chat>()
  private clients = new Map<string, Client>()
  private tokens = new Map<string, string>()

  constructor(readonly o: GatewayOptions) {
    this.store = new ChatStore(o.dataDir)
    for (const meta of this.store.listMetas()) this.chats.set(meta.id, new Chat(this.store, meta, true))
    this.asks = new AskManager({
      onAsk: (chatId, turnId, askId, spec) => this.emit(chatId, turnId, { t: 'ask', askId, spec }),
      onAnswer: (chatId, turnId, askId, answer) => this.emit(chatId, turnId, { t: 'ask_answer', askId, answer }),
    })
    o.artifacts.on('change', (name?: string) => this.broadcastAll({ type: 'artifacts', artifacts: o.artifacts.list(), pinned: o.artifacts.pinned, changed: name }))
    o.live.on('change', () => this.broadcastAll({ type: 'live', sessions: this.liveSessions() }))
    o.review.on('change', () => this.broadcastAll({ type: 'review', review: o.review.snapshot() }))
  }

  // ---------- chats ----------

  listChats(): ChatMeta[] {
    return [...this.chats.values()].filter((c) => c.persisted).map((c) => c.meta).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private chat(id: string | null | undefined): Chat | undefined {
    return id ? this.chats.get(id)?.load() : undefined
  }

  createChat(agent?: string, model?: string): ChatMeta {
    const now = Date.now()
    const a = agent && this.o.registry.get(agent) ? agent : this.o.defaultAgent
    const meta: ChatMeta = { id: newId('c_'), title: '', agent: a, model: a === this.o.defaultAgent ? model ?? this.o.defaultModel : model, createdAt: now, updatedAt: now, turns: 0 }
    this.chats.set(meta.id, new Chat(this.store, meta, false).load())
    return meta
  }

  /**
   * The effort to send. It is dropped only when the chat's model is in the already-fetched model list and does
   * not offer that level among two or more; with no list yet (or a failed one) or an unlisted model it passes
   * through, so a failed `model/list` never silently loses the user's choice and turns never wait on a listing.
   * CodeBuddy's runner never sends `--effort` regardless.
   */
  private effortFor(agent: string, model: string | undefined, effort: string | undefined): string | undefined {
    return supportedEffort(this.o.registry.cachedModels(agent) ?? [], model, effort)
  }

  updateChat(id: string, patch: { title?: string; agent?: string; model?: string | null; effort?: string | null; fast?: boolean }): ChatMeta {
    const c = this.chat(id)
    if (!c) throw new Error('no such chat')
    if (patch.title !== undefined) c.meta.title = truncate(patch.title.trim(), 80)
    if (patch.agent !== undefined && patch.agent !== c.meta.agent) {
      if (!this.o.registry.get(patch.agent)) throw new Error('unknown agent')
      c.meta.agent = patch.agent
      c.meta.agentSessionId = undefined
      c.meta.model = undefined
      c.meta.effort = undefined
      c.meta.fast = undefined
    }
    if (patch.model !== undefined) {
      if ((patch.model ?? undefined) !== c.meta.model) {
        // Codex and OpenCode take the model per turn, so the session survives a model switch.
        c.meta.agentSessionId = c.meta.agent === 'codex' || c.meta.agent === 'opencode' ? c.meta.agentSessionId : undefined
        c.meta.effort = undefined
      }
      c.meta.model = patch.model || undefined
    }
    if (patch.effort !== undefined) c.meta.effort = patch.effort || undefined
    if (patch.fast !== undefined) c.meta.fast = patch.fast === true || undefined
    if (c.persisted) c.persist()
    this.broadcastState(c)
    this.broadcastChats()
    return c.meta
  }

  deleteChat(id: string): void {
    const c = this.chat(id)
    if (!c) throw new Error('no such chat')
    c.deleted = true
    c.flush()
    c.running?.ac.abort()
    c.queue = []
    this.chats.delete(id)
    this.store.delete(id)
    for (const cl of this.clients.values()) if (cl.chatId === id) cl.chatId = null
    this.broadcastChats()
  }

  snapshot(id: string): ChatSnapshot | undefined {
    const c = this.chat(id)
    if (!c) return undefined
    const turns = c.turns.slice(-PAGE_SIZE)
    return { chat: c.meta, turns, hasMore: c.turns.length > turns.length, queue: c.queue, running: c.running?.turnId ?? null, pendingAsks: this.asks.pendingFor(id) }
  }

  /** Turns older than `before` (a turn id), newest last. */
  page(id: string, before?: string, limit = PAGE_SIZE): { turns: TurnView[]; hasMore: boolean } | undefined {
    const c = this.chat(id)
    if (!c) return undefined
    const end = before ? c.turns.findIndex((t) => t.id === before) : c.turns.length
    const stop = end < 0 ? c.turns.length : end
    const start = Math.max(0, stop - Math.min(200, Math.max(1, limit)))
    return { turns: c.turns.slice(start, stop), hasMore: start > 0 }
  }

  turns(id: string): TurnView[] | undefined {
    return this.chat(id)?.turns
  }

  search(q: string, chatId?: string, limit = 100): SearchHit[] {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const hits: SearchHit[] = []
    const chats = chatId ? [this.chat(chatId)].filter(Boolean) as Chat[] : this.listChats().map((m) => this.chat(m.id)!)
    const snip = (text: string) => {
      const i = text.toLowerCase().indexOf(needle)
      if (i < 0) return null
      const from = Math.max(0, i - 60)
      return (from ? '…' : '') + text.slice(from, i + needle.length + 100).replace(/\s+/g, ' ') + (i + needle.length + 100 < text.length ? '…' : '')
    }
    for (const c of chats) {
      if (c.meta.title.toLowerCase().includes(needle) && !c.turns.length) hits.push({ chatId: c.meta.id, title: c.meta.title, turnId: '', ts: c.meta.updatedAt, role: 'user', snippet: c.meta.title })
      for (let i = c.turns.length - 1; i >= 0; i--) {
        const t = c.turns[i]
        const u = snip(t.user.text)
        if (u) hits.push({ chatId: c.meta.id, title: c.meta.title, turnId: t.id, ts: t.ts, role: 'user', snippet: u })
        const a = snip(turnText(t))
        if (a) hits.push({ chatId: c.meta.id, title: c.meta.title, turnId: t.id, ts: t.ts, role: 'agent', snippet: a })
        if (hits.length >= limit) return hits
      }
    }
    return hits
  }

  exportMarkdown(id: string): string | undefined {
    const c = this.chat(id)
    if (!c) return undefined
    const out = [`# ${c.meta.title || 'Chat'}`, '', `Agent: ${c.meta.agent}${c.meta.model ? ` (${c.meta.model})` : ''} · ${new Date(c.meta.createdAt).toISOString()}`, '']
    for (const t of c.turns) {
      out.push(`## You · ${new Date(t.ts).toLocaleString()}`, '', t.user.text || '(no text)', '')
      if (t.user.picks.length) out.push(...t.user.picks.map((p) => `> picked \`${p.selector}\``), '')
      out.push(`## ${t.agent}`, '')
      for (const i of t.items) {
        if (i.kind === 'text') out.push(i.text, '')
        else if (i.kind === 'tool') out.push(`- tool \`${i.name}\` (${i.status})`)
        else if (i.kind === 'error') out.push(`> error: ${i.message}`, '')
        else if (i.kind === 'notice') out.push(`> ${i.message}`, '')
      }
      if (t.files.length) out.push('', 'Changed files: ' + t.files.map((f) => `\`${f}\``).join(', '), '')
    }
    return out.join('\n')
  }

  // ---------- events ----------

  private emit(chatId: string, turnId: string, body: ChatEventBody): void {
    const c = this.chats.get(chatId)
    if (!c) return
    const ev = c.emit(turnId, body)
    for (const cl of this.clients.values()) if (cl.chatId === chatId && cl.role !== 'artifacts') cl.send({ type: 'event', event: ev })
  }

  private broadcastAll(msg: ServerMsg): void {
    for (const cl of this.clients.values()) if (cl.who.access === 'owner' || REVIEWER_RECEIVES.has(msg.type)) cl.send(msg)
  }

  private broadcastChats(): void {
    const chats = this.listChats()
    for (const cl of this.clients.values()) if (cl.who.access === 'owner') cl.send({ type: 'chats', chats, active: cl.chatId ?? undefined })
  }

  private broadcastState(c: Chat): void {
    const msg: ServerMsg = { type: 'state', chatId: c.meta.id, chat: c.meta, queue: c.queue, running: c.running?.turnId ?? null }
    for (const cl of this.clients.values()) if (cl.chatId === c.meta.id) cl.send(msg)
  }

  private liveSessions() {
    return this.o.live.list().slice(0, 50)
  }

  // ---------- queue and turns ----------

  enqueue(chatId: string, msg: UserMessage, front = false, tab?: string): QueueItem {
    const c = this.chat(chatId)
    if (!c) throw new Error('no such chat')
    const item: QueueItem = { ...msg, id: newId('q_'), createdAt: Date.now(), ...(tab ? { tab } : {}) }
    if (!c.meta.title) {
      c.meta.title = truncate((msg.text || msg.picks[0]?.selector || 'Chat').replace(/\s+/g, ' ').trim(), 48)
      c.persist()
      this.broadcastChats()
    }
    if (front) c.queue.unshift(item)
    else c.queue.push(item)
    c.saveQueue()
    this.broadcastState(c)
    this.pump(c)
    return item
  }

  cancel(chatId: string): void {
    const c = this.chat(chatId)
    if (!c?.running) return
    c.running.ac.abort()
    this.o.bridge.stop(chatId)
    this.asks.cancelTurn(chatId, c.running.turnId)
  }

  retry(chatId: string, turnId: string, tab?: string): void {
    const c = this.chat(chatId)
    const t = c?.turns.find((x) => x.id === turnId)
    if (!c || !t) throw new Error('no such turn')
    if (t.user.live) throw new Error('retry Live requests from the page')
    const { text, attachments, picks, marks, pageUrl } = t.user
    this.enqueue(chatId, { text, attachments, picks, marks, pageUrl }, false, tab)
  }

  reorder(chatId: string, ids: string[]): void {
    const c = this.chat(chatId)
    if (!c) return
    const byId = new Map(c.queue.map((q) => [q.id, q]))
    const next = ids.map((id) => byId.get(id)).filter((q): q is QueueItem => !!q)
    for (const q of c.queue) if (!next.includes(q)) next.push(q)
    c.queue = next
    c.saveQueue()
    this.broadcastState(c)
  }

  dequeue(chatId: string, id: string): void {
    const c = this.chat(chatId)
    if (!c) return
    c.queue = c.queue.filter((q) => q.id !== id)
    c.saveQueue()
    this.broadcastState(c)
  }

  liveOp(clientChat: string | null, req: LiveRequest, tab?: string): void {
    const existing = req.sid ? this.o.live.get(req.sid) : undefined
    const chatId = existing?.chatId ?? clientChat
    if (!chatId || !this.chats.has(chatId)) throw new LiveError('open a chat first')
    if (!existing && (req.op === 'generate' || req.op === 'insert' || req.op === 'steer')) void this.o.guard.ensureBaseline()
    const patch = existing?.source === 'patch'
    if (patch && req.op !== 'discard' && this.o.mode !== 'review') throw new LiveError('these candidates were made without source; discard them, or restart in review mode to keep them')
    if (patch && req.op === 'accept') {
      const n = existing.variants.find((v) => v.index === req.variant)?.changes?.length ?? 0
      if (!this.o.review.hasRoom(n)) throw new LiveError(`there are already ${MAX_REVIEW_ITEMS} review items; remove some first`)
    }
    const plan = this.o.live.request(chatId, req)
    if (req.op === 'accept' && patch) this.keepCandidate(existing, req.variant!, req.looks)
    if (req.op === 'discard' && patch) this.cancelLiveTurns(chatId, existing.sid)
    if (!plan) return
    this.enqueue(chatId, { text: plan.summary, attachments: [], picks: [], marks: req.marks, live: { ...req, sid: plan.sid }, pageUrl: req.url }, true, tab)
  }

  private cancelLiveTurns(chatId: string, sid: string): void {
    const c = this.chat(chatId)
    if (!c) return
    const before = c.queue.length
    c.queue = c.queue.filter((q) => q.live?.sid !== sid)
    if (c.queue.length !== before) c.saveQueue()
    if (c.running?.item.live?.sid === sid) c.running.ac.abort()
    this.broadcastState(c)
  }

  /** An accepted no-source candidate becomes one change item per element. Looks ride along for the reader-facing entries. */
  private keepCandidate(s: LiveSession, index: number, looks?: { selector: string; look: ReviewLook }[]): void {
    const v = s.variants.find((x) => x.index === index)
    if (!v?.changes) return
    const author = this.o.team.author('owner')
    for (const ch of v.changes) {
      const look = looks?.find((l) => l.selector === ch.selector)?.look
      this.o.review.add({ kind: 'patch', path: s.url ?? s.path ?? '/', host: this.o.review.defaultHost, selector: ch.selector, anchor: ch.anchor, label: ch.label, note: `Live: ${v.label}`, patch: ch.patch, author, chatId: s.chatId, look })
    }
  }

  /** History "continue in panel": point every open chat panel at this chat and send its snapshot. */
  private focusChat(id: string): void {
    if (!id || !this.chats.has(id)) return
    const snap = this.snapshot(id)
    const c = this.chat(id)
    if (!snap || !c) return
    for (const cl of this.clients.values()) {
      if (cl.role !== 'chat' || cl.who.access !== 'owner') continue
      const old = cl.chatId
      cl.chatId = id
      this.o.bridge.rebind(cl.id, old)
      cl.send({ type: 'chats', chats: this.listChats(), active: id })
      cl.send({ type: 'snapshot', snapshot: snap })
      this.pump(c)
    }
  }

  private pump(c: Chat): void {
    if (c.running || !c.queue.length) return
    const item = c.queue.shift()!
    c.saveQueue()
    const turnId = newId('t_')
    c.running = { turnId, ac: new AbortController(), item }
    if (item.tab) this.o.bridge.pin(c.meta.id, item.tab)
    void this.runTurn(c, item, turnId).finally(() => {
      this.o.bridge.unpin(c.meta.id)
      c.running = null
      c.flush()
      this.broadcastState(c)
      setImmediate(() => this.pump(c))
    })
  }

  private async runTurn(c: Chat, item: QueueItem, turnId: string): Promise<void> {
    const chatId = c.meta.id
    const started = Date.now()
    const runner = this.o.registry.get(c.meta.agent)
    const { id: _id, createdAt: _ca, tab: _tab, ...user } = item
    this.emit(chatId, turnId, { t: 'turn_begin', user, agent: c.meta.agent, model: c.meta.model })
    this.broadcastState(c)
    const signal = c.running!.ac.signal
    let status: TurnEndStatus = 'done'
    let message: string | undefined
    let usage: Usage | undefined
    const files = new Set<string>()
    const live = item.live?.sid ? this.o.live.get(item.live.sid) : undefined
    if (live) this.o.live.bindTurn(live.sid, turnId)

    const end = () => {
      if (signal.aborted && status !== 'error') status = 'cancelled'
      this.emit(chatId, turnId, { t: 'turn_end', status, usage, durationMs: Date.now() - started, message })
      c.meta.turns = c.turns.length
      c.meta.updatedAt = Date.now()
      const last = c.turns[c.turns.length - 1]
      if (last) c.meta.preview = truncate(turnText(last).replace(/\s+/g, ' ').trim() || last.user.text, 120)
      c.persist()
      this.broadcastChats()
      this.o.live.turnEnded(turnId, status)
    }

    if (this.o.noAgent || !runner || !this.o.registry.available(c.meta.agent)) {
      status = 'error'
      message = this.o.noAgent ? 'This session is review-only and does not run an agent.' : `Agent "${c.meta.agent}" is not available. Install its CLI or pick another agent.`
      this.emit(chatId, turnId, { t: 'error', message })
      end()
      return
    }

    const scope: McpScope = { chatId, turnId }
    const token = this.o.auth.issueMcpToken(scope)
    this.tokens.set(turnId, token)
    try {
      const built = buildPrompt(item, {
        uploads: this.o.uploads,
        project: this.o.project,
        nativeImages: runner.images,
        liveText: live && item.live ? requestText(live, item.live) : undefined,
      })
      let system = baseInstructions({ project: this.o.project, target: this.o.target, appUrl: this.o.appUrl, mode: this.o.mode })
      if (item.live) system += '\n\n' + (this.o.mode === 'source' ? LIVE_SKILL : LIVE_PATCH_SKILL)
      const input: TurnInput = {
        chatId,
        turnId,
        prompt: built.prompt,
        system,
        images: built.images,
        cwd: this.o.project,
        model: c.meta.model,
        effort: this.effortFor(c.meta.agent, c.meta.model, c.meta.effort),
        fast: c.meta.fast,
        resumeId: c.meta.agentSessionId,
        mcp: { name: MCP_SERVER_NAME, url: this.o.mcpUrl, token },
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        let output = false
        let retry = false
        for await (const ev of runner.run(input, signal) as AsyncIterable<AgentEvent>) {
          if (ev.type === 'session') {
            if (c.meta.agentSessionId !== ev.sessionId) {
              c.meta.agentSessionId = ev.sessionId
              c.persist()
            }
          } else if (ev.type === 'text' || ev.type === 'thinking') {
            output = true
            this.emit(chatId, turnId, { t: ev.type, delta: ev.delta })
          } else if (ev.type === 'tool') {
            output = true
            for (const f of ev.files ?? []) files.add(f)
            this.emit(chatId, turnId, { t: 'tool', id: ev.id, name: ev.name, input: ev.input, status: ev.status, output: ev.output, files: ev.files })
          } else if (ev.type === 'done') {
            usage = ev.usage
            if (ev.sessionId && ev.sessionId !== c.meta.agentSessionId) {
              c.meta.agentSessionId = ev.sessionId
              c.persist()
            }
          } else if (ev.type === 'error') {
            if (!output && input.resumeId && attempt === 0 && !signal.aborted) {
              retry = true
              log.debug(`resume failed for ${chatId}, starting a fresh agent session: ${ev.message}`)
            } else if (!signal.aborted) {
              status = 'error'
              message = ev.message
              this.emit(chatId, turnId, { t: 'error', message: ev.message })
            }
          }
        }
        if (!retry) break
        input.resumeId = undefined
        c.meta.agentSessionId = undefined
        this.emit(chatId, turnId, { t: 'notice', level: 'warn', message: 'The previous agent session could not be resumed; started a fresh one.' })
      }
    } catch (e) {
      if (!signal.aborted) {
        status = 'error'
        message = e instanceof Error ? e.message : String(e)
        this.emit(chatId, turnId, { t: 'error', message })
      }
    } finally {
      this.o.auth.revokeMcpToken(token)
      this.tokens.delete(turnId)
      this.asks.cancelTurn(chatId, turnId)
    }
    if (item.live || files.size) await this.checkMarkers(chatId, turnId)
    end()
  }

  private async checkMarkers(chatId: string, turnId: string): Promise<void> {
    try {
      const found = await this.o.guard.scan()
      const open = new Set(this.o.live.open().map((s) => s.sid))
      const stale = found.filter((f) => !open.has(f.sid))
      if (stale.length) {
        const where = [...new Set(stale.map((f) => `${f.file} (${f.sid})`))].join(', ')
        this.emit(chatId, turnId, { t: 'notice', level: 'warn', message: `Live candidate markers are still in the source: ${where}. Ask the agent to remove them before committing.` })
      }
    } catch (e) {
      log.debug('marker scan failed', e)
    }
  }

  // ---------- tool host (MCP) ----------

  toolHost(): ToolHost {
    return {
      project: this.o.project,
      mode: this.o.mode,
      review: this.o.review,
      probe: (scope, selector) => this.o.bridge.probe(scope.chatId, selector),
      pageUrl: (scope) => this.chats.get(scope.chatId)?.running?.item.pageUrl,
      artifacts: this.o.artifacts,
      page: (scope, cmd) => this.o.bridge.run(scope.chatId, cmd),
      ask: (scope, spec) => this.asks.ask(scope.chatId, scope.turnId, spec),
      live: (scope, u) => this.o.live.update(scope.chatId, u),
      livePatches: (scope, sid, variants) => this.o.live.setPatchVariants(scope.chatId, sid, variants),
      artifactWritten: (scope, name, version) => this.emit(scope.chatId, scope.turnId, { t: 'artifact', name, version }),
      previewArtifact: (_scope, name) => this.broadcastAll({ type: 'artifacts', artifacts: this.o.artifacts.list(), pinned: this.o.artifacts.pinned, changed: name, open: name }),
    }
  }

  // ---------- WebSocket clients ----------

  hello(agents: AgentInfo[], who: Who = { access: 'owner' }): ServerMsg {
    const author = this.o.team.author(who.access, who.id)
    const me = { access: who.access, id: author.id, name: who.access === 'reviewer' && !this.o.team.hasName(who.id ?? '') ? '' : author.name }
    if (who.access === 'reviewer') return { type: 'hello', version: PROTOCOL_VERSION, project: '', target: this.o.target, agents: [], defaultAgent: '', mode: this.o.mode, me }
    return { type: 'hello', version: PROTOCOL_VERSION, project: this.o.project, target: this.o.target, agents, defaultAgent: this.o.defaultAgent, mode: this.o.mode, me, share: this.o.shareUrl }
  }

  connect(client: Client): void {
    this.clients.set(client.id, client)
    client.send(this.hello(this.o.registry.list(), client.who))
    client.send({ type: 'artifacts', artifacts: this.o.artifacts.list(), pinned: this.o.artifacts.pinned })
    client.send({ type: 'review', review: this.o.review.snapshot() })
    if (client.who.access !== 'owner') return
    this.o.bridge.attach({ id: client.id, get chatId() { return client.chatId }, send: (m) => client.send(m as ServerMsg) })
    client.send({ type: 'live', sessions: this.liveSessions() })
  }

  private author(client: Client) {
    return this.o.team.author(client.who.access, client.who.id)
  }

  /** Review actions shared by owners and reviewers. Returns false when the message is not one. */
  private reviewOp(client: Client, msg: ClientMsg): boolean {
    const owner = client.who.access === 'owner'
    const me = this.author(client)
    switch (msg.type) {
      case 'set_name':
        this.o.team.setName(client.who.access, client.who.id, String(msg.name ?? ''))
        client.send(this.hello(this.o.registry.list(), client.who))
        return true
      case 'review_add': {
        const d = msg.draft
        if (!owner && !this.o.team.hasName(client.who.id ?? '')) throw new Error('set your name first')
        if (d?.kind === 'patch' && this.o.mode !== 'review') throw new Error('page changes are only available in review mode; with source, ask the agent to edit the code')
        this.o.review.add({ kind: d?.kind === 'patch' ? 'patch' : 'note', path: String(d?.url ?? '/'), host: typeof d?.host === 'string' ? d.host : undefined, selector: String(d?.selector ?? ''), anchor: d?.anchor, label: d?.label, note: String(d?.note ?? ''), severity: d?.severity, patch: d?.patch, look: d?.look, author: me })
        return true
      }
      case 'review_reply':
        if (!owner && !this.o.team.hasName(client.who.id ?? '')) throw new Error('set your name first')
        this.o.review.reply(msg.id, me, String(msg.text ?? ''))
        return true
      case 'review_edit': {
        if (!owner && !this.o.team.hasName(client.who.id ?? '')) throw new Error('set your name first')
        const item = this.o.review.get(msg.id)
        if (!item) throw new Error('this note is gone')
        if (!this.o.review.canRemove(item, me, owner)) throw new Error('only the author or the owner can edit this')
        this.o.review.editNote(msg.id, String(msg.note ?? ''))
        return true
      }
      case 'review_status':
        if (!owner && !this.o.team.hasName(client.who.id ?? '')) throw new Error('set your name first')
        this.o.review.setStatus(msg.id, msg.status === 'resolved' ? 'resolved' : 'open')
        return true
      case 'review_approve':
        if (!owner && !this.o.team.hasName(client.who.id ?? '')) throw new Error('set your name first')
        this.o.review.approve(String(msg.url ?? '/'), me, msg.status === 'approved' || msg.status === 'changes' ? msg.status : null, msg.host)
        return true
      case 'review_look':
        if (msg.look) this.o.review.attachLook(msg.id, msg.look)
        return true
      case 'review_remove': {
        const item = this.o.review.get(msg.id)
        if (!item) return true
        if (!this.o.review.canRemove(item, me, owner)) throw new Error('only the author or the owner can delete this')
        this.o.review.remove(msg.id)
        return true
      }
    }
    return false
  }

  disconnect(clientId: string): void {
    this.clients.delete(clientId)
    this.o.bridge.detach(clientId)
  }

  handle(client: Client, msg: ClientMsg): void {
    try {
      this.dispatch(client, msg)
    } catch (e) {
      client.send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  private dispatch(client: Client, msg: ClientMsg): void {
    if (this.reviewOp(client, msg)) return
    if (client.who.access !== 'owner') {
      if (REVIEWER_IGNORED.has(msg.type)) return
      throw new Error('reviewers can comment, reply, resolve and approve; only the owner can do this')
    }
    const chatId = client.chatId
    switch (msg.type) {
      case 'subscribe': {
        const old = client.chatId
        client.role = msg.role
        let target = msg.chat && this.chats.has(msg.chat) ? msg.chat : null
        if (!target && msg.role !== 'history') target = this.listChats()[0]?.id ?? this.createChat().id
        client.chatId = target
        this.o.bridge.rebind(client.id, old)
        client.send({ type: 'chats', chats: this.listChats(), active: target ?? undefined })
        if (target) {
          client.send({ type: 'snapshot', snapshot: this.snapshot(target)! })
          const c = this.chat(target)!
          if (msg.role === 'chat') this.pump(c)
        }
        return
      }
      case 'focus_chat':
        this.focusChat(msg.id)
        return
      case 'ping':
        return
      case 'page_control':
        this.o.bridge.update(client.id, { on: msg.on, attached: msg.attached, visible: msg.visible, tab: msg.tab, version: msg.version })
        return
      case 'page_visibility':
        this.o.bridge.update(client.id, { visible: msg.visible })
        return
      case 'page_result':
        this.o.bridge.result(client.id, msg.id, msg.result)
        return
      case 'probe_result':
        this.o.bridge.probeResult(client.id, msg.id, msg.result)
        return
      case 'review_clear':
        this.o.review.clear(msg.host)
        return
      case 'review_export': {
        if (!this.o.review.list().length) throw new Error('there are no notes to export yet')
        const name = 'page-review.md'
        this.o.artifacts.write(name, Buffer.from(this.o.review.markdown(this.o.target), 'utf8'), { chatId: chatId ?? undefined })
        this.broadcastAll({ type: 'artifacts', artifacts: this.o.artifacts.list(), pinned: this.o.artifacts.pinned, changed: name, open: name })
        return
      }
      case 'answer':
        if (!this.asks.answer(msg.askId, msg.answer as AskAnswer)) throw new Error('this question is no longer waiting for an answer')
        return
      case 'live_op':
        if (this.o.noAgent) throw new Error('this session is review-only and does not run an agent')
        this.liveOp(chatId, msg.request, this.o.bridge.tabOf(client.id))
        return
    }
    if (!chatId) throw new Error('no chat selected')
    switch (msg.type) {
      case 'prompt': {
        const m = msg.message
        if (!m.text?.trim() && !m.attachments?.length && !m.picks?.length) throw new Error('empty message')
        // A follow-up while candidates wait for a choice asks for another set, not for review items.
        const waiting = !m.picks?.length && !m.attachments?.length && m.text?.trim() ? this.o.live.list().find((s) => s.chatId === chatId && s.status === 'ready' && s.kind !== 'insert' && (s.source === 'patch') === (this.o.mode === 'review')) : undefined
        if (waiting) {
          this.liveOp(chatId, { op: 'revise', sid: waiting.sid, prompt: String(m.text).trim(), marks: m.marks, url: m.pageUrl ?? waiting.url }, this.o.bridge.tabOf(client.id))
          return
        }
        this.enqueue(chatId, { text: String(m.text ?? ''), attachments: m.attachments ?? [], picks: m.picks ?? [], marks: m.marks, pageUrl: m.pageUrl }, false, this.o.bridge.tabOf(client.id))
        return
      }
      case 'cancel':
        this.cancel(chatId)
        return
      case 'retry':
        this.retry(chatId, msg.turnId, this.o.bridge.tabOf(client.id))
        return
      case 'queue_reorder':
        this.reorder(chatId, msg.ids)
        return
      case 'dequeue':
        this.dequeue(chatId, msg.id)
        return
      case 'page_stop':
        this.o.bridge.stop(chatId)
        return
    }
  }

  /** Open notes for the copied prompt's paging API. Reading does not change status. */
  listReviewPage(q: { scope: 'here' | 'all'; path: string; page: number; pageSize: number; host?: string }) {
    return this.o.review.page(q)
  }

  /** Notes for one site, for the home page and the bookmarklet overlay. */
  reviewSlice(host: string) {
    return this.o.review.forHost(host)
  }

  reviewSites() {
    return this.o.review.sites()
  }

  ownerMe() {
    const author = this.o.team.author('owner')
    return { access: 'owner' as const, id: author.id, name: author.name }
  }

  /** Review action from the bookmarklet, as the owner, with no panel session. */
  runOwnerReview(msg: ClientMsg): void {
    // Clear stays owner-only on the WebSocket (it is not a reviewer action), so handle it here too.
    if (msg.type === 'review_clear') {
      this.o.review.clear(msg.host)
      return
    }
    const client: Client = { id: 'bookmarklet', chatId: null, role: 'chat', who: { access: 'owner' }, send() {} }
    if (!this.reviewOp(client, msg)) throw new Error('not a review action')
  }

  /**
   * Marks one note resolved for the local agent.
   * The HTTP route only calls this after the per-run resolve secret checks out.
   * An unknown number returns undefined. Marking an already-resolved note does not add a reply.
   */
  resolveReviewN(n: number, result: string): { ok: true; n: number; status: 'resolved'; already?: true } | undefined {
    const item = this.o.review.list().find((i) => i.n === n)
    if (!item) return undefined
    if (item.status === 'resolved') return { ok: true, n: item.n, status: 'resolved', already: true }
    const summary = result.trim()
    this.o.review.setStatus(item.id, 'resolved', { id: 'local-agent', name: 'Local agent', kind: 'agent' }, summary || undefined)
    return { ok: true, n: item.n, status: 'resolved' }
  }

  /** Stops every running turn (shutdown). */
  async shutdown(): Promise<void> {
    for (const c of this.chats.values()) {
      c.running?.ac.abort()
      c.flush()
    }
    const deadline = Date.now() + 3000
    while ([...this.chats.values()].some((c) => c.running) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    for (const c of this.chats.values()) c.flush()
  }
}

/**
 * `effort` unless the model (or the default model when none is chosen) is listed and does not offer it among two
 * or more levels. An empty list or a model missing from it means "unknown", and the effort passes through.
 */
export function supportedEffort(models: ModelInfo[], model: string | undefined, effort: string | undefined): string | undefined {
  if (!effort) return undefined
  const m = model ? models.find((x) => x.id === model) : models.find((x) => x.isDefault)
  if (!m || m.fallback) return effort
  return m.efforts && m.efforts.length > 1 && m.efforts.includes(effort) ? effort : undefined
}
