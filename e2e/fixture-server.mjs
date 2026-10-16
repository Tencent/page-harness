// Serves the e2e fixture app from a scratch project directory (re-read on every request, like a dev server),
// then starts page-harness in front of it with the scripted test agent.
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const project = path.join(here, '.tmp', 'project')
rmSync(path.join(here, '.tmp'), { recursive: true, force: true })
mkdirSync(project, { recursive: true })
copyFileSync(path.join(here, 'fixture', 'index.html'), path.join(project, 'index.html'))

const port = Number(process.env.FIXTURE_PORT ?? 5179)
const appPort = Number(process.env.APP_PORT ?? 17980)
http
  .createServer((req, res) => {
    const file = path.join(project, 'index.html')
    if (req.url === '/__version') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      res.end(String(statSync(file).mtimeMs))
      return
    }
    if (req.url?.startsWith('/favicon')) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    const version = String(statSync(file).mtimeMs)
    res.end(readFileSync(file, 'utf8').replace('let v = null', `let v = ${JSON.stringify(version)}`))
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`fixture on http://127.0.0.1:${port}`)
    // A second harness in front of the same app, forced into review mode (no source to edit).
    const reviewProject = path.join(here, '.tmp', 'review-project')
    const bookmarkletProject = path.join(here, '.tmp', 'bookmarklet-project')
    const noAgentProject = path.join(here, '.tmp', 'noagent-project')
    const embedProject = path.join(here, '.tmp', 'embed-project')
    mkdirSync(reviewProject, { recursive: true })
    mkdirSync(bookmarkletProject, { recursive: true })
    mkdirSync(noAgentProject, { recursive: true })
    mkdirSync(embedProject, { recursive: true })
    const reviewPort = Number(process.env.REVIEW_PORT ?? appPort + 4)
    const noAgentPort = Number(process.env.NOAGENT_PORT ?? appPort + 6)
    const bookmarkletPort = Number(process.env.BOOKMARKLET_PORT ?? appPort + 8)
    const embedPort = Number(process.env.EMBED_PORT ?? appPort + 10)
    const cli = path.join(here, '..', 'dist', 'cli.js')
    const harness = (dir, p, extra = []) =>
      spawn(process.execPath, [cli, `http://127.0.0.1:${port}`, '--project', dir, '--agent', 'fake', '--port', String(p), '--control-port', String(p + 1), ...extra], {
        stdio: 'inherit',
        env: { ...process.env, PH_FAKE_AGENT: '1' },
      })
    const bare = (args) => spawn(process.execPath, [cli, ...args], { stdio: 'inherit', env: { ...process.env, PH_FAKE_AGENT: '1' } })
    const clis = [
      harness(project, appPort),
      harness(reviewProject, reviewPort, ['--review', '--share', '--host', '127.0.0.1']),
      bare(['--project', bookmarkletProject, '--control-port', String(bookmarkletPort), '--host', '127.0.0.1']),
      bare([`http://127.0.0.1:${port}`, '--project', noAgentProject, '--no-agent', '--port', String(noAgentPort), '--control-port', String(noAgentPort + 1), '--host', '127.0.0.1']),
      bare([
        `http://127.0.0.1:${port}`,
        '--project', embedProject,
        '--no-agent',
        '--port', String(embedPort),
        '--control-port', String(embedPort + 1),
        '--host', '127.0.0.1',
        '--embed-origin', `http://localhost:${appPort}`,
      ]),
    ]
    const stop = () => clis.forEach((c) => c.kill('SIGTERM'))
    process.on('SIGTERM', () => (stop(), process.exit(0)))
    process.on('SIGINT', () => (stop(), process.exit(0)))
    for (const c of clis) c.on('exit', (code) => (stop(), process.exit(code ?? 0)))
  })
