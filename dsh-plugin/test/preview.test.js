import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { sameOrigin } from '../lib/host-utils.js'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PreviewManager, assertLocalTarget, cliArgs, normalizeTarget } from '../lib/preview.js'

const cliPath = fileURLToPath(new URL('./fake-cli.mjs', import.meta.url))
const project = mkdtempSync(path.join(os.tmpdir(), 'phd-test-'))
const base = { cliPath, project, port: 17990, host: '0.0.0.0', share: true, publicHost: 'preview.example.com', publicScheme: 'http', withAgent: false }

let manager
afterEach(async () => {
  delete process.env.FAKE_MODE
  await manager?.dispose()
})

describe('PreviewManager', () => {
  it('starts, reports the share link, and stops', async () => {
    manager = new PreviewManager()
    const s = await manager.start({ ...base, target: '5173' })
    assert.equal(s.running, true)
    assert.equal(s.target, 'http://localhost:5173/')
    assert.equal(s.shareUrl, 'http://preview.example.com:17991/__ph/join?t=abc')
    assert.equal(s.controlPort, 17991)
    assert.equal(s.noAgent, true)
    await manager.stop()
    assert.equal(manager.status().running, false)
  })

  it('reuses a running preview of the same page', async () => {
    manager = new PreviewManager()
    const a = await manager.start({ ...base, target: 'http://localhost:5173' })
    const b = await manager.start({ ...base, target: 'localhost:5173' })
    assert.equal(a.pid, b.pid)
    const c = await manager.start({ ...base, target: '3000' })
    assert.notEqual(c.pid, a.pid)
    assert.equal(c.target, 'http://localhost:3000/')
  })

  it('retries once on the next port pair when the first ports are busy', async () => {
    let n = 0
    manager = new PreviewManager({
      spawn: (cmd, args, opts) => {
        n++
        return spawn(cmd, args, { ...opts, env: { ...process.env, FAKE_MODE: n === 1 ? 'crash' : 'ready' } })
      },
    })
    const s = await manager.start({ ...base, target: '5173', port: 17980 })
    assert.equal(n, 2)
    assert.equal(s.running, true)
    assert.equal(s.port, 17982)
  })

  it('surfaces the CLI error when it exits before ready', async () => {
    process.env.FAKE_MODE = 'crash'
    manager = new PreviewManager()
    await assert.rejects(manager.start({ ...base, target: '5173' }), /already in use/)
    assert.match(manager.status().error, /already in use/)
  })

  it('times out when the CLI never becomes ready', async () => {
    process.env.FAKE_MODE = 'silent'
    manager = new PreviewManager({ readyTimeoutMs: 300 })
    await assert.rejects(manager.start({ ...base, target: '5173' }), /did not start/)
    assert.equal(manager.status().running, false)
  })

  it('restarts when the port or agent mode changes', async () => {
    manager = new PreviewManager()
    const a = await manager.start({ ...base, target: '5173', port: 17980 })
    const b = await manager.start({ ...base, target: '5173', port: 17980, withAgent: true })
    assert.notEqual(a.pid, b.pid)
    const c = await manager.start({ ...base, target: '5173', port: 17982, withAgent: true })
    assert.notEqual(c.pid, b.pid)
    assert.equal(c.port, 17982)
  })

  it('ignores a ready line that arrives after stop', async () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdout.setEncoding = () => {}
    child.stderr.setEncoding = () => {}
    child.exitCode = null
    child.signalCode = null
    child.kill = () => {
      child.signalCode = 'SIGTERM'
      child.emit('exit', null, 'SIGTERM')
    }
    const ready = JSON.stringify({ event: 'ready', appUrl: 'http://127.0.0.1:1', controlUrl: 'http://127.0.0.1:2', shareUrl: null, mode: 'review', noAgent: true, version: '0', pid: 1 }) + '\n'
    manager = new PreviewManager({ spawn: () => child })
    const pending = manager.start({ ...base, target: '5173' })
    await new Promise((r) => setImmediate(r))
    child.stdout.emit('data', ready)
    await pending
    assert.equal(manager.status().running, true)
    const stopped = manager.stop()
    child.stdout.emit('data', ready)
    await stopped
    assert.equal(manager.status().running, false)
  })

  it('rejects a missing project or CLI', async () => {
    manager = new PreviewManager()
    await assert.rejects(manager.start({ ...base, target: '5173', project: path.join(project, 'nope') }), /project directory not found/)
    await assert.rejects(manager.start({ ...base, target: '5173', cliPath: path.join(project, 'nope.js') }), /CLI not found/)
  })
})

describe('helpers', () => {
  it('builds share arguments', () => {
    const args = cliArgs('/x/cli.js', { ...base, target: 'http://localhost:5173/', publicScheme: 'https' })
    assert.deepEqual(args, ['/x/cli.js', 'http://localhost:5173/', '--project', project, '--json', '--port', '17990', '--control-port', '17991', '--host', '0.0.0.0', '--share', '--public-host', 'preview.example.com', '--public-scheme', 'https', '--no-agent'])
    assert.ok(!cliArgs('/x/cli.js', { ...base, target: 'x', withAgent: true }).includes('--no-agent'))
  })

  it('builds embedded preview arguments', () => {
    const args = cliArgs('/x/cli.js', { ...base, share: false, publicHost: '', host: '127.0.0.1', target: 'http://127.0.0.1:9/', embedOrigins: ['http://localhost:3080'] })
    assert.ok(!args.includes('--share') && !args.includes('--public-host'))
    assert.deepEqual(args.slice(args.indexOf('--embed-origin'), args.indexOf('--embed-origin') + 2), ['--embed-origin', 'http://localhost:3080'])
  })

  it('normalizes page targets', () => {
    assert.equal(normalizeTarget('5173'), 'http://localhost:5173/')
    assert.equal(normalizeTarget('example.com:8080/a'), 'http://example.com:8080/a')
    assert.throws(() => normalizeTarget(''), /missing/)
    assert.equal(assertLocalTarget('10.1.2.3'), 'http://10.1.2.3/')
    assert.equal(assertLocalTarget('http://[::1]/x'), 'http://[::1]/x')
    assert.throws(() => assertLocalTarget('https://example.com'), /private-network/)
    assert.throws(() => assertLocalTarget('http://169.254.169.254/'), /private-network/)
  })

  it('accepts same-origin requests only', () => {
    const req = (headers) => ({ headers })
    assert.equal(sameOrigin(req({ origin: 'http://127.0.0.1:3091', host: '127.0.0.1:3091' })), true)
    assert.equal(sameOrigin(req({ origin: 'https://dsh.example.com', host: '127.0.0.1:3091', 'x-forwarded-host': 'dsh.example.com' })), true)
    assert.equal(sameOrigin(req({ origin: 'https://evil.example', host: '127.0.0.1:3091' })), false)
    assert.equal(sameOrigin(req({ host: '127.0.0.1:3091' })), false)
  })
})
