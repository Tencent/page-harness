// Startup is not guaranteed: the page's own server can be down, on the wrong port, or in the wrong directory.
// This checks the URL first. A static site is served here. Anything else becomes one command for the agent,
// and the preview starts only after that URL answers.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { normalizeTarget } from './preview.js'

export async function probeHttp(raw, timeoutMs = 800) {
  const href = normalizeTarget(raw)
  const u = new URL(href)
  const lib = u.protocol === 'https:' ? https : http
  return new Promise((resolve) => {
    const req = lib.request(
      { method: 'GET', hostname: u.hostname, port: u.port || undefined, path: `${u.pathname}${u.search}`, timeout: timeoutMs, headers: { accept: 'text/html,*/*' } },
      (res) => {
        res.resume()
        resolve({ ok: res.statusCode < 500, status: res.statusCode })
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }))
    req.end()
  })
}

/** A few attempts, so a server that is still binding counts as up. */
export async function waitForHttp(raw, { attempts = 4, gapMs = 300, timeoutMs = 800 } = {}) {
  let last = { ok: false, error: 'no attempt' }
  for (let i = 0; i < attempts; i++) {
    last = await probeHttp(raw, timeoutMs)
    if (last.ok) return last
    if (i + 1 < attempts) await new Promise((r) => setTimeout(r, gapMs))
  }
  return last
}

function existingDir(cwd) {
  const raw = path.resolve(String(cwd || process.cwd()))
  if (existsSync(raw)) return raw
  const trimmed = path.resolve(String(cwd || process.cwd()).trim())
  if (trimmed !== raw && existsSync(trimmed)) return trimmed
  return raw
}

function isProject(dir) {
  return ['package.json', 'index.html', 'pyproject.toml', 'manage.py'].some((name) => existsSync(path.join(dir, name)))
}

function soleChildProject(dir) {
  let kids
  try {
    kids = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
  } catch {
    return ''
  }
  const projects = kids.map((d) => path.join(dir, d.name)).filter(isProject)
  return projects.length === 1 ? projects[0] : ''
}

/**
 * The directory that actually holds the site. A session cwd with a trailing space, or a checkout
 * nested one level down, still resolves when there is exactly one project inside.
 */
export function resolveProjectDir(cwd, rel = '') {
  const given = existingDir(cwd)
  if (rel) {
    const file = path.resolve(given, rel)
    if (existsSync(file)) return given
  }
  if (isProject(given)) return given
  return soleChildProject(given) || given
}

function readScripts(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {}
  } catch {
    return {}
  }
}

/** Plain files the plugin can serve itself. A dev or start script belongs to the agent. */
export function isStaticProject(dir) {
  if (!existsSync(path.join(dir, 'index.html')) || !statSync(path.join(dir, 'index.html')).isFile()) return false
  const scripts = readScripts(dir)
  return !scripts.dev && !scripts.start
}

/** One command, one directory, the same URL. The agent runs it; the plugin checks the port again. */
export function agentPlan(cwd, url) {
  const href = normalizeTarget(url)
  const port = new URL(href).port || (new URL(href).protocol === 'https:' ? '443' : '80')
  const project = resolveProjectDir(cwd)
  const scripts = readScripts(project)
  let command = `start the server for this project so it listens on port ${port}`
  if (scripts.dev) command = `npm run dev -- --host 127.0.0.1 --port ${port}`
  else if (scripts.start) command = 'npm start'
  else if (existsSync(path.join(project, 'index.html'))) command = `python3 -m http.server ${port} --bind 127.0.0.1`
  return {
    needsAgent: true,
    running: false,
    waitingForPage: false,
    url: href,
    project,
    command,
    reason: `GET ${href} 没有响应。`,
    error: `GET ${href} 没有响应。`,
  }
}
