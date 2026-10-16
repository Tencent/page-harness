import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { readBody, renderNotes, renderPreview, renderStatus, sameOrigin, sendJson } from './host-utils.js'
import { DEV_PORTS, detectDevServers } from './detect.js'
import { PagePreview, readNotes } from './page-preview.js'
import { PreviewManager, READY_TIMEOUT_MS } from './preview.js'

export const name = 'page-harness'
export const inject = ['tools']

export const Config = Schema.object({
  previewPort: Schema.number().default(17994).description('右栏预览端口。本机或 SSH 转发时只监听 127.0.0.1；从其他地址打开 DSH 时监听 0.0.0.0，并用嵌入令牌限制访问。控制端口是它 +1'),
  port: Schema.number().default(17990).description('分享端口。控制端口固定为它 +1，两个端口都要对同事开放'),
  host: Schema.string().default('0.0.0.0').description('分享的监听地址'),
  publicHost: Schema.string().default('').description('同事访问用的主机名或 IP（公网 IP / 域名）。留空用本机第一个局域网地址'),
  publicScheme: Schema.union(['http', 'https']).default('http').description('前面有 TLS 终止的负载均衡时选 https'),
  withAgent: Schema.boolean().default(false).description('分享时同时启用本机 Agent CLI（Claude Code、Codex 等）。默认只评审：取点和意见'),
  cliPath: Schema.string().default('').description('page-harness 的 dist/cli.js 路径。留空自动查找'),
})

export function apply(ctx, config) {
  const share = new PreviewManager()
  const preview = new PagePreview()
  let lastProject = ''
  ctx.effect(() => () => Promise.all([share.dispose(), preview.dispose()]), 'page-harness-preview')

  const startShare = async (target, project) => {
    if (project) lastProject = project
    return share.start({ ...config, share: true, target, project: project || lastProject || process.cwd() })
  }

  ctx.tools.register(defineTool({
    name: 'page_harness_preview',
    description:
      'Show a web page in the preview pane on the right of the DSH chat, with page-harness tools on it (pick elements, quote them into this chat, leave notes). Call it after you write or change an HTML page, passing the file path (relative to the workspace), and after you start a web or dev server, passing its URL. Calling it again reloads the pane. Do not open the page through bash.',
    parameters: {
      path: { type: 'string', description: 'HTML file or directory to show, relative to the workspace, e.g. index.html. Default index.html.' },
      url: { type: 'string', description: 'Dev server URL or port instead of a file, e.g. 5173.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderPreview(value) }],
      presentationMeta: (_args, value) => ({ kind: 'page-harness-preview', ...value }),
    },
    presentCall: (args) => ({ card: 'generic', title: `预览 · ${args.url || args.path || 'index.html'}`, content: [] }),
    presentResult: (_args, { isError }) => ({ card: 'generic', title: isError ? '预览打开失败' : '已在右侧预览', content: [] }),
    timeoutMs: READY_TIMEOUT_MS + 10_000,
    async execute(args, exec) {
      const cwd = exec.agent?.session?.header?.cwd || process.cwd()
      if (!args.path && !args.url) args = { ...args, path: 'index.html' }
      return clone(await preview.open({ path: args.path ? String(args.path) : '', url: args.url ? String(args.url) : '', cwd }, config))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'page_harness_notes',
    description: 'Read the open notes the user left on the preview pane (element, comment, suggested text or style change). Call it when the user asks you to apply their notes or comments on the page.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderNotes(value) }],
    },
    presentCall: () => ({ card: 'generic', title: '读取页面意见', content: [] }),
    async execute(_args, exec) {
      const project = preview.status().project || exec.agent?.session?.header?.cwd || ''
      return clone({ project, items: readNotes(project) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'page_harness_share',
    description:
      'Start a page-harness share preview of a running web page: teammates open the invite link and leave notes (pick elements, comment, approve) on the live page. Pass the dev server URL or port. Call once; a running preview of the same page is reused. After success, give the user the share link exactly as returned. Do not start page-harness through bash.',
    parameters: {
      url: { type: 'string', required: true, description: 'Page to share: a port (5173), host:port, or full URL' },
      project: { type: 'string', description: 'Project directory for notes. Default: the session workspace.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
      presentationMeta: (_args, value) => ({ kind: 'page-harness-share', ...value }),
    },
    presentCall: (args) => ({ card: 'generic', title: `分享预览 · ${args.url}`, content: [] }),
    presentResult: (_args, { isError }) => ({ card: 'generic', title: isError ? '分享预览启动失败' : '分享预览已启动', content: [] }),
    timeoutMs: READY_TIMEOUT_MS + 10_000,
    async execute(args, exec) {
      const project = args.project ? String(args.project) : exec.agent?.session?.header?.cwd
      return clone(await startShare(String(args.url ?? ''), project))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'page_harness_status',
    description: 'Show whether a page-harness share preview is running and its share link.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
      presentationMeta: (_args, value) => ({ kind: 'page-harness-share', ...value }),
    },
    presentCall: () => ({ card: 'generic', title: '分享预览状态', content: [] }),
    async execute() {
      return clone(share.status())
    },
  }))

  ctx.tools.register(defineTool({
    name: 'page_harness_stop',
    description: 'Stop the running page-harness share preview. The invite link stops working until it is started again.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: () => [{ type: 'text', text: '分享预览已停止。' }],
    },
    presentCall: () => ({ card: 'generic', title: '停止分享预览', content: [] }),
    async execute() {
      await share.stop()
      return clone(share.status())
    },
  }))

  ctx.inject(['systemPrompt'], (c) => {
    c.systemPrompt.section({
      name: 'tool:page-harness',
      order: 220,
      text: [
        'After you write or change a web page (HTML file or a dev server), call page_harness_preview with its path or URL: it shows the page in the preview pane on the right of this chat. Call it again after later edits to reload the pane.',
        'page_harness_preview checks that the URL responds before it starts, and serves a static site itself. If the result says the page is not up, run only the command it gives, in the directory it gives, with run_in_background. When that port answers, call page_harness_preview again with the same URL. Do not pick another directory or port, and do not run page-harness yourself. Prefer an explicit port when you start a server.',
        'A <page-element url selector tag text>…</page-element> block in a user message is an element the user picked in the preview, with its outerHTML inside; the request around it is about that element. Edit the source file that produces it, and refer to it by what it is (the "提交" button), not by the raw block.',
        'When the user asks to apply their notes on the page (按意见改, 处理批注), call page_harness_notes and apply each open note.',
        'When the user wants teammates to preview or review a running web page (分享预览, 让同事看看页面, share preview), call page_harness_share with the dev server URL or port; give the share link exactly as returned, and mention that both the share port and the port after it must be reachable. Use page_harness_status to look up the link and page_harness_stop to stop sharing.',
        'Never run page-harness or npx page-harness through bash: the host process manages it.',
      ].join(' '),
    })
  })

  ctx.inject(['webServer'], (c) => {
    c.webServer.register({
      kind: 'exact',
      path: '/page-harness',
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'same-origin requests only' })
          if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return sendJson(res, 415, { ok: false, error: 'JSON only' })
          preview.setEmbedOrigin(req.headers.origin)
          const body = await readBody(req)
          const method = String(body.method ?? 'status')
          if (method === 'status') return sendJson(res, 200, { ok: true, ...share.status(), lastProject })
          if (method === 'start') return sendJson(res, 200, { ok: true, ...(await startShare(String(body.url ?? ''), body.project ? String(body.project) : '')) })
          if (method === 'stop') {
            await share.stop()
            return sendJson(res, 200, { ok: true, ...share.status() })
          }
          if (method === 'previewStatus') {
            const s = preview.status()
            if (preview.request && !s.running && !s.starting && !s.error) return sendJson(res, 200, { ok: true, ...(await preview.open(null, config)) })
            return sendJson(res, 200, { ok: true, ...s })
          }
          if (method === 'preview') {
            const req2 = body.path || body.url ? { path: String(body.path ?? ''), url: String(body.url ?? ''), cwd: String(body.cwd ?? '') } : null
            return sendJson(res, 200, { ok: true, ...(await preview.open(req2, config)) })
          }
          if (method === 'detect') {
            const own = [config.port, config.port + 1, config.previewPort, config.previewPort + 1, config.previewPort + 2, req.socket.localPort]
            const extra = (Array.isArray(body.ports) ? body.ports : []).map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536).slice(0, 10)
            const ports = [...new Set([...DEV_PORTS, ...extra])]
            return sendJson(res, 200, { ok: true, servers: await detectDevServers({ exclude: own, ports }) })
          }
          if (method === 'previewStop') {
            await preview.stop()
            return sendJson(res, 200, { ok: true, ...preview.status() })
          }
          sendJson(res, 400, { ok: false, error: 'unknown method' })
        } catch (e) {
          sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
        }
      },
    })
  })

  ctx.inject(['settings'], (c) => {
    c.settings.register('page-harness', Config, { base: config })
  })
}

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}
