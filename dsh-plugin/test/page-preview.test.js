import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderNotes, renderPreview } from '../lib/host-utils.js'
import { PagePreview, readNotes } from '../lib/page-preview.js'
import { PreviewManager } from '../lib/preview.js'
import { detectDevServers } from '../lib/detect.js'
import { spawn } from 'node:child_process'
import { StaticServer, pagePath } from '../lib/static.js'

const cliPath = fileURLToPath(new URL('./fake-cli.mjs', import.meta.url))
const config = { previewPort: 27994, cliPath }
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'phd-page-'))

const cleanup = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()()
})

describe('StaticServer', () => {
  it('serves files under the root and nothing outside it', async () => {
    const root = tmp()
    mkdirSync(path.join(root, 'sub dir'))
    writeFileSync(path.join(root, 'index.html'), '<h1>home</h1>')
    writeFileSync(path.join(root, 'sub dir', 'index.html'), '<h1>sub</h1>')
    const files = new StaticServer()
    cleanup.push(() => files.close())
    const origin = await files.serve(root)
    const home = await fetch(origin + '/')
    assert.equal(home.status, 200)
    assert.match(home.headers.get('content-type'), /text\/html/)
    assert.equal(await home.text(), '<h1>home</h1>')
    assert.equal(await (await fetch(origin + pagePath(root, path.join(root, 'sub dir', 'index.html')))).text(), '<h1>sub</h1>')
    assert.equal((await fetch(origin + '/%2e%2e/%2e%2e/etc/passwd')).status, 404)
    const outside = tmp()
    writeFileSync(path.join(outside, 'secret.txt'), 'nope')
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
    assert.equal((await fetch(origin + '/link.txt')).status, 404)
    assert.equal((await fetch(origin + '/missing.html')).status, 404)
    assert.equal((await fetch(origin + '/', { method: 'POST' })).status, 405)
  })

  it('falls back to any port when the preferred one is busy', async () => {
    const a = new StaticServer()
    const b = new StaticServer()
    cleanup.push(() => a.close(), () => b.close())
    await a.serve(tmp())
    await b.serve(tmp(), a.port)
    assert.notEqual(b.port, a.port)
  })
})

describe('PagePreview', () => {
  const make = () => {
    const p = new PagePreview()
    cleanup.push(() => p.dispose())
    return p
  }

  it('waits for the DSH page before starting', async () => {
    const cwd = tmp()
    writeFileSync(path.join(cwd, 'index.html'), 'x')
    const calls = []
    const manager = new PreviewManager({ spawn: (cmd, args, opts) => (calls.push(args), spawn(cmd, args, opts)) })
    const p = new PagePreview({ manager })
    cleanup.push(() => p.dispose())
    const s = await p.open({ path: 'index.html', cwd }, config)
    assert.equal(s.waitingForPage, true)
    assert.equal(s.running, false)
    p.setEmbedOrigin('http://localhost:3080')
    const t = await p.open(null, config)
    assert.equal(t.running, true)
    assert.equal(t.page, '/index.html')
    assert.equal(t.rev, 1)
    const args = calls[0]
    assert.equal(calls.length, 1)
    assert.equal(args[args.indexOf('--embed-origin') + 1], 'http://localhost:3080')
    assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1')
    assert.ok(args.includes('--no-agent') && !args.includes('--share'))
  })

  it('listens on all interfaces when DSH is opened by IP', async () => {
    const cwd = tmp()
    writeFileSync(path.join(cwd, 'index.html'), 'x')
    const calls = []
    const manager = new PreviewManager({ spawn: (cmd, args, opts) => (calls.push(args), spawn(cmd, args, opts)) })
    const p = new PagePreview({ manager })
    cleanup.push(() => p.dispose())
    p.setEmbedOrigin('http://21.130.250.101:3080')
    await p.open({ path: 'index.html', cwd }, config)
    const args = calls[0]
    assert.equal(args[args.indexOf('--host') + 1], '0.0.0.0')
    assert.equal(args[args.indexOf('--public-host') + 1], '21.130.250.101')
    assert.equal(args[args.indexOf('--embed-origin') + 1], 'http://21.130.250.101:3080')
  })

  it('serves a nested file from the workspace and reloads on the next call', async () => {
    const cwd = tmp()
    mkdirSync(path.join(cwd, 'site'))
    writeFileSync(path.join(cwd, 'site', 'index.html'), 'x')
    const p = make()
    p.setEmbedOrigin('http://localhost:3080')
    const a = await p.open({ path: 'site', cwd }, config)
    assert.equal(a.page, '/site/index.html')
    assert.equal(a.label, path.join('site', 'index.html'))
    const b = await p.open({ path: 'site/index.html', cwd }, config)
    assert.equal(b.pid, a.pid)
    assert.equal(b.rev, 2)
  })

  it('rejects files outside the workspace and public URLs', async () => {
    const cwd = tmp()
    const outside = tmp()
    writeFileSync(path.join(outside, 'index.html'), 'x')
    const p = make()
    p.setEmbedOrigin('http://localhost:3080')
    await assert.rejects(p.open({ path: path.join(outside, 'index.html'), cwd }, config), /outside the workspace/)
    await assert.rejects(p.open({ url: 'http://169.254.169.254/', cwd }, config), /private-network/)
  })

  it('previews a dev server URL once it responds, and rejects missing files', async () => {
    const p = make()
    p.probe = async () => ({ ok: true })
    p.setEmbedOrigin('http://localhost:3080')
    const s = await p.open({ url: '5173/app?x=1', cwd: tmp() }, config)
    assert.equal(s.target, 'http://localhost:5173/')
    assert.equal(s.page, '/app?x=1')
    await assert.rejects(p.open({ path: 'nope.html', cwd: tmp() }, config), /file not found/)
  })

  it('serves a static site itself when the given URL is down', async () => {
    const cwd = tmp()
    writeFileSync(path.join(cwd, 'index.html'), 'x')
    const calls = []
    const manager = new PreviewManager({ spawn: (cmd, args, opts) => (calls.push(args), spawn(cmd, args, opts)) })
    const p = new PagePreview({ manager, probe: async () => ({ ok: false }) })
    cleanup.push(() => p.dispose())
    p.setEmbedOrigin('http://localhost:3080')
    const s = await p.open({ url: 'http://127.0.0.1:8000/index.html', cwd }, config)
    assert.equal(s.running, true)
    assert.equal(s.page, '/index.html')
    assert.match(calls[0][1], /^http:\/\/127\.0\.0\.1:\d+\/$/)
    assert.doesNotMatch(calls[0][1], /:8000/)
  })

  it('asks the agent to start a dev server instead of previewing a dead URL', async () => {
    const cwd = tmp()
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    const calls = []
    const manager = new PreviewManager({ spawn: (cmd, args, opts) => (calls.push(args), spawn(cmd, args, opts)) })
    const p = new PagePreview({ manager, probe: async () => ({ ok: false, error: 'ECONNREFUSED' }) })
    cleanup.push(() => p.dispose())
    p.setEmbedOrigin('http://localhost:3080')
    await assert.rejects(p.open({ url: '5173', cwd }, config), /npm run dev -- --host 127\.0\.0\.1 --port 5173/)
    assert.equal(calls.length, 0)
    assert.match(renderPreview({ needsAgent: true, reason: 'GET http://localhost:5173/ 没有响应。', project: cwd, command: 'npm run dev -- --host 127.0.0.1 --port 5173', url: 'http://localhost:5173/' }), /不要换端口/)
  })

  it('ignores malformed embed origins', () => {
    const p = make()
    p.setEmbedOrigin('http://localhost:3080/path')
    p.setEmbedOrigin(undefined)
    assert.equal(p.embedOrigin, '')
  })
})

describe('notes', () => {
  it('reads open notes from review.json', () => {
    const project = tmp()
    mkdirSync(path.join(project, '.page-harness'))
    writeFileSync(path.join(project, '.page-harness', 'review.json'), JSON.stringify({
      items: [
        { n: 1, kind: 'note', path: '/', selector: 'h1', note: 'bigger', status: 'open', author: { name: 'Ann' }, replies: [{ text: 'ok' }] },
        { n: 2, kind: 'note', path: '/', selector: 'p', note: 'done', status: 'resolved', replies: [] },
      ],
    }))
    const items = readNotes(project)
    assert.deepEqual(items.map((i) => i.n), [1])
    assert.equal(items[0].author, 'Ann')
    assert.deepEqual(items[0].replies, ['ok'])
    assert.deepEqual(readNotes(tmp()), [])
    assert.match(renderNotes({ project, items }), /#1 \[\/\] h1/)
    assert.match(renderNotes({ project, items: [] }), /没有未解决的意见/)
  })

  it('renders the preview result for the agent', () => {
    assert.match(renderPreview({ running: true, label: 'index.html' }), /已在右侧预览：index.html/)
    assert.match(renderPreview({ waitingForPage: true }), /打开 DSH 页面后/)
    assert.match(renderPreview({ running: false, error: 'boom' }), /boom/)
  })
})

describe('detectDevServers', () => {
  it('finds HTML servers and skips other ports', async () => {
    const http = await import('node:http')
    const html = http.createServer((_q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<title> My App </title>'))
    const json = http.createServer((_q, r) => r.writeHead(200, { 'content-type': 'application/json' }).end('{}'))
    await Promise.all([html, json].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))))
    cleanup.push(() => new Promise((ok) => html.close(ok)), () => new Promise((ok) => json.close(ok)))
    const a = html.address().port
    const b = json.address().port
    const found = await detectDevServers({ ports: [a, b, 1] })
    assert.deepEqual(found, [{ port: a, url: `http://localhost:${a}/`, title: 'My App' }])
    assert.deepEqual(await detectDevServers({ ports: [a], exclude: [a] }), [])
  })
})
