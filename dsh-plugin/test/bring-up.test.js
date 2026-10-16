import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { agentPlan, isStaticProject, probeHttp, resolveProjectDir, waitForHttp } from '../lib/bring-up.js'

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'phd-up-'))

describe('bring-up', () => {
  it('finds a project nested one level down, and a directory whose name has a trailing space', () => {
    const parent = `${tmp()} `
    mkdirSync(parent)
    const child = path.join(parent, 'introduction')
    mkdirSync(child)
    writeFileSync(path.join(child, 'index.html'), 'x')
    assert.equal(resolveProjectDir(parent), child)
    writeFileSync(path.join(parent, 'index.html'), 'x')
    assert.equal(resolveProjectDir(parent), parent)
    assert.equal(isStaticProject(child), true)
  })

  it('keeps a dev script for the agent and serves a static site itself', () => {
    const dir = tmp()
    writeFileSync(path.join(dir, 'index.html'), 'x')
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    assert.equal(isStaticProject(dir), false)
    const plan = agentPlan(dir, '5173/docs')
    assert.equal(plan.needsAgent, true)
    assert.equal(plan.command, 'npm run dev -- --host 127.0.0.1 --port 5173')
    assert.equal(plan.url, 'http://localhost:5173/docs')
    assert.equal(plan.project, dir)
  })

  it('waits until the page answers', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('ok')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    try {
      const down = await probeHttp('http://127.0.0.1:1/', 200)
      assert.equal(down.ok, false)
      const up = await waitForHttp(`http://127.0.0.1:${port}/`, { attempts: 2, gapMs: 10, timeoutMs: 500 })
      assert.equal(up.ok, true)
      assert.equal(up.status, 200)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})