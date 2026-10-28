// Runs one page-harness share preview as a child process of the dsh host.
// The agent's bash runs in a sandbox and cannot keep a server alive, so the host spawns it.
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { BlockList, isIP } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCAL_NETS = new BlockList()
LOCAL_NETS.addSubnet('127.0.0.0', 8, 'ipv4')
LOCAL_NETS.addSubnet('10.0.0.0', 8, 'ipv4')
LOCAL_NETS.addSubnet('172.16.0.0', 12, 'ipv4')
LOCAL_NETS.addSubnet('192.168.0.0', 16, 'ipv4')
LOCAL_NETS.addAddress('::1', 'ipv6')
LOCAL_NETS.addSubnet('fc00::', 7, 'ipv6')

export const READY_TIMEOUT_MS = 60_000
const TAIL_BYTES = 4096

/** Configured path, then the repo build next to this plugin, then an installed page-harness package. */
export function resolveCli(configured) {
  if (configured) return existsSync(configured) ? path.resolve(configured) : null
  const sibling = fileURLToPath(new URL('../../dist/cli.js', import.meta.url))
  if (existsSync(sibling)) return sibling
  try {
    const pkg = createRequire(import.meta.url).resolve('page-harness/package.json')
    const cli = path.join(path.dirname(pkg), 'dist', 'cli.js')
    if (existsSync(cli)) return cli
  } catch {}
  return null
}

export function normalizeTarget(raw) {
  let s = String(raw ?? '').trim()
  if (!s) throw new Error('missing the page URL to share')
  if (/^\d+(?:[/?#]|$)/.test(s)) s = `http://localhost:${s}`
  else if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  const u = new URL(s)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('the page URL must be http(s)')
  return u.href
}

/** Preview and share only reach this machine or a private network. Link-local and public hosts are rejected. */
export function assertLocalTarget(raw) {
  const href = normalizeTarget(raw)
  const host = new URL(href).hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return href
  const kind = isIP(host)
  if (kind === 4 && LOCAL_NETS.check(host, 'ipv4')) return href
  if (kind === 6 && LOCAL_NETS.check(host, 'ipv6')) return href
  throw new Error('the page URL must be a localhost or private-network address')
}

export function cliArgs(cli, o) {
  const args = [cli, o.target, '--project', o.project, '--json', '--port', String(o.port), '--control-port', String(o.port + 1), '--host', o.host]
  if (o.share) args.push('--share')
  if (o.publicHost) args.push('--public-host', o.publicHost)
  if (o.publicScheme === 'https') args.push('--public-scheme', 'https')
  for (const origin of o.embedOrigins ?? []) args.push('--embed-origin', origin)
  if (!o.withAgent) args.push('--no-agent')
  return args
}

const runKey = (o) => JSON.stringify([
  o.target,
  o.project,
  o.share ?? false,
  o.host,
  o.publicHost ?? '',
  [...(o.embedOrigins ?? [])].sort(),
  o.port,
  o.publicScheme ?? 'http',
  !!o.withAgent,
])

export class PreviewManager {
  constructor(opts = {}) {
    this.spawn = opts.spawn ?? spawn
    this.readyTimeoutMs = opts.readyTimeoutMs ?? READY_TIMEOUT_MS
    this.child = null
    this.info = null
    this.error = ''
    this.pending = null
    this.chain = Promise.resolve()
    this.onExit = () => this.child?.kill('SIGTERM')
    process.on('exit', this.onExit)
  }

  status() {
    const { key: _key, ...info } = this.info ?? {}
    return {
      running: !!this.info,
      starting: !!this.pending,
      error: this.error || null,
      ...info,
    }
  }

  /** One start at a time, so two callers cannot leave an orphan holding the port. */
  enqueue(fn) {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(() => {}, () => {})
    return run
  }

  /** Reuses a running preview of the same page, project, port and embedders; otherwise replaces it. */
  start(o) {
    return this.enqueue(() => this.startOne(o))
  }

  async startOne(o) {
    const target = assertLocalTarget(o.target)
    const project = path.resolve(o.project || process.cwd())
    if (!existsSync(project) || !statSync(project).isDirectory()) throw new Error(`project directory not found: ${project}`)
    const port = Number(o.port)
    if (!Number.isInteger(port) || port < 1 || port > 65534) throw new Error('port must be between 1 and 65534 (the control port is port + 1)')
    const run = { ...o, target, project, port, host: o.host || '0.0.0.0' }
    if (this.info && this.info.key === runKey(run)) return this.status()
    await this.stop()
    const cli = resolveCli(o.cliPath)
    if (!cli) throw new Error('page-harness CLI not found: run npm run build in the page-harness repo, or set cliPath')
    this.error = ''
    this.pending = this.launch(cli, run)
    let retry = null
    try {
      await this.pending
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // One busy pair of ports is the usual miss. The next pair is port+2 because the control port is port+1.
      if (!run._retried && run.port + 2 <= 65534 && /already in use|EADDRINUSE/i.test(msg)) retry = { ...run, port: run.port + 2, _retried: true }
      else {
        this.error = msg
        throw e
      }
    } finally {
      this.pending = null
    }
    if (retry) return this.startOne(retry)
    return this.status()
  }

  launch(cli, o) {
    return new Promise((resolve, reject) => {
      const child = this.spawn(process.execPath, cliArgs(cli, o), { cwd: o.project, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
      this.child = child
      let out = ''
      let tail = ''
      let settled = false
      const fail = (msg) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.kill('SIGTERM')
        reject(new Error(msg))
      }
      const timer = setTimeout(() => fail(`page-harness did not start within ${Math.round(this.readyTimeoutMs / 1000)}s${tail ? `:\n${tail.trim()}` : ''}`), this.readyTimeoutMs)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (d) => (tail = (tail + d).slice(-TAIL_BYTES)))
      child.stdout.on('data', (d) => {
        out += d
        let i
        while ((i = out.indexOf('\n')) >= 0) {
          const line = out.slice(0, i).trim()
          out = out.slice(i + 1)
          const ready = parseReady(line)
          if (!ready || settled || this.child !== child) continue
          settled = true
          clearTimeout(timer)
          this.info = { ...ready, key: runKey(o), target: o.target, project: o.project, port: o.port, controlPort: o.port + 1, startedAt: Date.now() }
          resolve()
        }
      })
      child.on('error', (e) => fail(`failed to start page-harness: ${e.message}`))
      child.on('exit', (code, signal) => {
        if (this.child === child) {
          this.child = null
          this.info = null
        }
        if (!settled) fail(`page-harness exited (${signal ?? code})${tail ? `:\n${tail.trim()}` : ''}`)
        else if (code && !this.error) this.error = `page-harness exited (${code})${tail ? `:\n${tail.trim()}` : ''}`
      })
    })
  }

  async stop() {
    const child = this.child
    this.child = null
    this.info = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise((resolve) => {
      const force = setTimeout(() => child.kill('SIGKILL'), 5000)
      child.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }

  async dispose() {
    process.off('exit', this.onExit)
    await this.stop()
  }
}

function parseReady(line) {
  if (!line.startsWith('{')) return null
  try {
    const d = JSON.parse(line)
    if (d?.event !== 'ready') return null
    return { appUrl: d.appUrl, controlUrl: d.controlUrl, shareUrl: d.shareUrl, mode: d.mode, noAgent: !!d.noAgent, version: d.version, pid: d.pid, ...(d.embedToken ? { embedToken: d.embedToken } : {}) }
  } catch {
    return null
  }
}
