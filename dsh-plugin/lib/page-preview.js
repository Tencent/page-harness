// The preview shown in DSH's right column: page-harness on loopback, framed by the DSH page.
// Plain files are served by a loopback static server; dev servers are proxied directly.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { agentPlan, isStaticProject, resolveProjectDir, waitForHttp } from './bring-up.js'
import { renderPreview } from './host-utils.js'
import { PreviewManager, assertLocalTarget } from './preview.js'
import { StaticServer, pagePath, withinRoot } from './static.js'

export class PagePreview {
  constructor(opts = {}) {
    this.manager = opts.manager ?? new PreviewManager()
    this.files = opts.files ?? new StaticServer()
    this.embedOrigin = ''
    this.probe = opts.probe ?? ((url) => waitForHttp(url))
    this.request = null
    this.page = ''
    this.label = ''
    this.rev = 0
  }

  /** Origin of the DSH page as the browser sees it. page-harness only lets this origin frame it. */
  setEmbedOrigin(origin) {
    if (typeof origin === 'string' && /^https?:\/\/[^/]+$/.test(origin)) this.embedOrigin = origin
  }

  status() {
    const s = this.manager.status()
    return {
      ...s,
      page: this.page,
      label: this.label,
      rev: this.rev,
      waitingForPage: !!this.request && !s.running && !this.embedOrigin,
    }
  }

  /**
   * Opens a file (relative to cwd) or a URL. Without arguments it reopens the last request.
   * Before any DSH page has reported its origin the request is kept and started on the next call.
   */
  async open(req, config) {
    const request = req && (req.path || req.url) ? { path: req.path || '', url: req.url || '', cwd: req.cwd || this.request?.cwd || '' } : this.request
    if (!request) throw new Error('nothing to preview yet: pass a file path or a URL')
    this.request = request
    if (!this.embedOrigin) return this.status()
    const cwd = resolveProjectDir(request.cwd || process.cwd(), request.url ? '' : request.path || 'index.html')
    let target, page, label
    if (request.url) {
      const requested = assertLocalTarget(request.url)
      const u = new URL(requested)
      const up = await this.probe(requested)
      if (!up.ok) {
        if (!isStaticProject(cwd)) throw new Error(renderPreview(agentPlan(cwd, requested)))
        target = (await this.files.serve(cwd, config.previewPort ? config.previewPort + 2 : 0)) + '/'
        page = u.pathname + u.search + u.hash
        label = path.basename(page.split(/[?#]/)[0]) || 'index.html'
      } else {
        target = u.origin + '/'
        page = u.pathname + u.search + u.hash
        label = u.href
      }
    } else {
      let file = path.resolve(cwd, request.path || 'index.html')
      if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html')
      if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`file not found: ${file}`)
      if (!withinRoot(cwd, file)) throw new Error(`file is outside the workspace: ${file}`)
      target = (await this.files.serve(cwd, config.previewPort ? config.previewPort + 2 : 0)) + '/'
      page = pagePath(cwd, file)
      label = path.relative(cwd, file) || path.basename(file)
    }
    const viewer = new URL(this.embedOrigin).hostname.replace(/^\[|\]$/g, '')
    const local = viewer === 'localhost' || viewer === '127.0.0.1' || viewer === '::1'
    await this.manager.start({
      target,
      project: cwd,
      port: config.previewPort,
      host: local ? '127.0.0.1' : '0.0.0.0',
      publicHost: local ? '' : viewer,
      share: false,
      embedOrigins: [this.embedOrigin],
      withAgent: false,
      publicScheme: config.publicScheme,
      cliPath: config.cliPath,
    })
    this.page = page
    this.label = label
    this.rev++
    return this.status()
  }

  async stop() {
    this.request = null
    this.page = ''
    this.label = ''
    await this.manager.stop()
  }

  async dispose() {
    await this.manager.dispose()
    await this.files.close()
  }
}

/** Open notes left on the preview, from page-harness's review.json in the project. */
export function readNotes(project) {
  if (!project) return []
  let data
  try {
    data = JSON.parse(readFileSync(path.join(project, '.page-harness', 'review.json'), 'utf8'))
  } catch {
    return []
  }
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
  return items
    .filter((i) => i && i.status !== 'resolved')
    .map((i) => ({
      n: i.n,
      kind: i.kind,
      path: i.path,
      selector: i.selector,
      label: i.label,
      note: i.note,
      patch: i.patch,
      author: i.author?.name,
      replies: (i.replies ?? []).map((r) => r.text).filter(Boolean),
    }))
}
