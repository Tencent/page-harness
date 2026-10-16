// Serves a directory over loopback HTTP so page-harness can proxy pages the agent wrote as plain files.
// The root can change without restarting, which keeps the page-harness preview on the same target.
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
}

export class StaticServer {
  constructor() {
    this.root = ''
    this.server = null
    this.port = 0
  }

  get origin() {
    return `http://127.0.0.1:${this.port}`
  }

  /** page-harness keys notes by host, so a stable port keeps them across restarts; 0 or a busy port falls back to any. */
  async serve(root, port = 0) {
    this.root = path.resolve(root)
    if (this.server) return this.origin
    const server = http.createServer((req, res) => this.handle(req, res))
    const listen = (p) => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(p, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    try {
      await listen(port)
    } catch (e) {
      if (!port || e?.code !== 'EADDRINUSE') throw e
      await listen(0)
    }
    this.server = server
    this.port = server.address().port
    return this.origin
  }

  /** Maps a URL path under the root to a file, or null when it escapes the root or does not exist. */
  resolve(urlPath) {
    let rel
    try {
      rel = decodeURIComponent(urlPath.split('?')[0])
    } catch {
      return null
    }
    const file = path.resolve(this.root, '.' + path.posix.normalize('/' + rel))
    if (file !== this.root && !file.startsWith(this.root + path.sep)) return null
    if (!existsSync(file)) return null
    const st = statSync(file)
    let target = file
    if (st.isDirectory()) {
      target = path.join(file, 'index.html')
      if (!existsSync(target) || !statSync(target).isFile()) return null
    } else if (!st.isFile()) return null
    return withinRoot(this.root, target) ? target : null
  }

  handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    const file = this.root ? this.resolve(req.url || '/') : null
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  }

  async close() {
    const s = this.server
    this.server = null
    if (!s) return
    s.closeAllConnections?.()
    await new Promise((resolve) => s.close(() => resolve()))
  }
}

/** True when realpath(file) stays inside realpath(root). A symlink that leaves the root is outside. */
export function withinRoot(root, file) {
  let base, real
  try {
    base = realpathSync(root)
    real = realpathSync(file)
  } catch {
    return false
  }
  const rel = path.relative(base, real)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

/** URL path of a file relative to the served root, with each segment encoded. */
export function pagePath(root, file) {
  const rel = path.relative(root, file).split(path.sep).map(encodeURIComponent).join('/')
  return '/' + rel
}
