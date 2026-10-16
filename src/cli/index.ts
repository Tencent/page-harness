import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { releaseAllCursorMcp } from '../agents/cursor'
import { killAllAgents } from '../agents/util'
import { startHarness } from '../server/harness'
import { parseLang } from '../shared/lang'
import { log } from '../server/log'

const HELP = `page-harness — Pick, Chat and Artifacts on top of any running frontend, driven by your local coding agent.
Without a URL it starts review-only: a home page with a bookmarklet, and notes grouped by site. No agent.

Usage
  page-harness [frontend-url] [options]

Examples
  npx page-harness http://localhost:5173
  npx page-harness 3000 --project ../web --agent codex
  npx page-harness --no-agent http://localhost:5173
  npx page-harness

Options
  --project <dir>        Project the agent works in (default: current directory)
  --agent <id>           claude | codex | cursor | codebuddy | opencode (default: first one installed)
  --model <name>         Default model for new chats
  --port <n>             App port: the proxied frontend (default 17990)
  --control-port <n>     Panel / API port (default: app port + 1, or 17991 with no URL)
  --host <addr>          Listen address (default 127.0.0.1)
  --allow-host <name>    Extra Host header to accept (repeatable), e.g. a LAN name
  --keep-host            Forward the browser's Host header to the target
  --public-scheme <s>    http | https: scheme browsers use to reach both ports (default http).
                         Use https behind a load balancer that terminates TLS on the same ports
  --open                 Open the browser
  --claude-path <bin>    Path to the claude CLI   (also --codex-path, --cursor-path, --codebuddy-path, --opencode-path)
  --live-guard-hook      Install a git pre-commit hook that rejects Live candidate markers
  --review               No source for this page: the agent leaves notes and page changes instead of editing files
                         (default for public sites; --source forces source mode)
  --no-agent             Review only. Do not detect or start an agent CLI. The dock is Pick and Notes
                         (comment, edit, reply, resolve, approve). No Chat, Artifacts, Live or page control.
                         Implied when no frontend URL is given.
  --lang <zh|en>         Home page and dock language. Omit it and each browser keeps its own.
  --share                Listen on the network and print an invite link: teammates join as reviewers
                         (comment, reply, resolve, approve, edit text/style in review mode; never the agent)
  --public-host <name>   Hostname or IP teammates use to reach this machine. Used in the invite link and
                         accepted as a Host header (default: the first LAN address)
  --json                 Print one JSON line with the URLs to stdout once the servers are listening
  --embed-origin <url>   Let this origin show the page in an iframe (repeatable), e.g. an IDE preview pane.
                         Pick → Quote then posts the element to that window instead of the chat
  --verbose / --quiet
  -v, --version
  -h, --help
`

function version(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const p of [path.join(here, '..', 'package.json'), path.join(here, '..', '..', 'package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8'))
      if (pkg.name === 'page-harness') return pkg.version
    } catch {}
  }
  return '0.0.0'
}

export function normalizeTarget(raw: string): URL {
  let s = raw.trim()
  if (/^\d+$/.test(s)) s = `http://localhost:${s}`
  else if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  const u = new URL(s)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('the frontend URL must be http(s)')
  return u
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.listen(port, host, () => s.close(() => resolve(true)))
  })
}

async function pickControlPort(host: string, control?: number): Promise<number> {
  if (control !== undefined) return control
  for (let p = 17991; p < 18091; p++) if (await portFree(p, host)) return p
  return 17991
}

async function pickPorts(host: string, app?: number, control?: number): Promise<[number, number]> {
  if (app !== undefined) return [app, control ?? app + 1]
  for (let p = 17990; p < 18090; p += 2) {
    const c = control ?? p + 1
    if ((await portFree(p, host)) && (await portFree(c, host))) return [p, c]
    if (control !== undefined) break
  }
  return [17990, control ?? 17991]
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {}
}

function intOpt(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`--${name} must be a port number`)
  return n
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      agent: { type: 'string' },
      model: { type: 'string' },
      port: { type: 'string' },
      'control-port': { type: 'string' },
      host: { type: 'string' },
      'allow-host': { type: 'string', multiple: true },
      'keep-host': { type: 'boolean' },
      'public-scheme': { type: 'string' },
      open: { type: 'boolean' },
      'claude-path': { type: 'string' },
      'codex-path': { type: 'string' },
      'cursor-path': { type: 'string' },
      'codebuddy-path': { type: 'string' },
      'opencode-path': { type: 'string' },
      'live-guard-hook': { type: 'boolean' },
      review: { type: 'boolean' },
      source: { type: 'boolean' },
      'no-agent': { type: 'boolean' },
      lang: { type: 'string' },
      share: { type: 'boolean' },
      'public-host': { type: 'string' },
      json: { type: 'boolean' },
      'embed-origin': { type: 'string', multiple: true },
      verbose: { type: 'boolean' },
      quiet: { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.version) {
    console.log(version())
    return
  }
  if (values.help) {
    process.stdout.write(HELP)
    return
  }
  if (values.verbose) log.setVerbose(true)
  if (values.quiet) log.setQuiet(true)
  const lang = parseLang(values.lang)
  const publicHost = publicHostOf(values['public-host'])

  const rawTarget = positionals[0]
  if (!rawTarget) {
    if (values.source) throw new Error('--source needs a frontend URL')
    if (values.share) throw new Error('--share needs a frontend URL')
    if (values.port) throw new Error('--port is the proxy port; with no URL only --control-port is used')
    if (values.agent) log.warn('--agent is ignored when there is no frontend URL (review-only, no agent)')
    const project = path.resolve(values.project ?? process.cwd())
    if (!existsSync(project) || !statSync(project).isDirectory()) throw new Error(`project directory not found: ${project}`)
    const host = values.host ?? '127.0.0.1'
    const controlPort = await pickControlPort(host, intOpt(values['control-port'], 'control-port'))
    const h = await startHarness({
      project,
      host,
      controlPort,
      allowHosts: values['allow-host'],
      publicScheme: schemeOf(values['public-scheme']),
      publicHost,
      noAgent: true,
      lang,
    })
    if (values.json) printReady(h, project)
    log.info(`v${version()}`)
    process.stderr.write(
      [
        `  Home     ${log.bold(h.controlUrl)}`,
        `  Project  ${project}`,
        `  Mode     review only ${log.dim('(no agent, no proxy — drag the bookmarklet onto any page)')}`,
        '',
      ].join('\n'),
    )
    if (values.open) openBrowser(h.controlUrl)
    return installShutdown(h)
  }

  const target = normalizeTarget(rawTarget)
  const project = path.resolve(values.project ?? process.cwd())
  if (!existsSync(project) || !statSync(project).isDirectory()) throw new Error(`project directory not found: ${project}`)
  const host = values.host ?? (values.share ? '0.0.0.0' : '127.0.0.1')
  const [appPort, controlPort] = await pickPorts(host, intOpt(values.port, 'port'), intOpt(values['control-port'], 'control-port'))
  if (appPort === controlPort) throw new Error('--port and --control-port must differ')
  if (values.review && values.source) throw new Error('use either --review or --source')
  if (values['no-agent'] && values.source) throw new Error('--no-agent is review-only and cannot be combined with --source')
  const publicScheme = schemeOf(values['public-scheme'])
  const noAgent = !!values['no-agent']

  const h = await startHarness({
    target,
    project,
    host,
    appPort,
    controlPort,
    agent: noAgent ? undefined : values.agent,
    model: values.model,
    allowHosts: values['allow-host'],
    keepHost: values['keep-host'],
    publicScheme,
    publicHost,
    embedOrigins: embedOriginsOf(values['embed-origin']),
    agentPaths: {
      claude: values['claude-path'],
      codex: values['codex-path'],
      cursor: values['cursor-path'],
      codebuddy: values['codebuddy-path'],
      opencode: values['opencode-path'],
    },
    liveGuardHook: values['live-guard-hook'],
    mode: values.review ? 'review' : values.source ? 'source' : undefined,
    share: values.share,
    noAgent,
    lang,
  })
  if (values.json) printReady(h, project, target)

  const agentLine = h.agents
    .map((a) => (a.available ? `${a.id === h.defaultAgent ? log.bold(a.id) : a.id}${a.version ? ` ${log.dim(a.version)}` : ''}` : log.dim(`${a.id} (not found)`)))
    .join('  ')
  log.info(`v${version()}`)
  const modeLine = h.noAgent
    ? `review ${log.dim('(no agent: Pick and Notes only)')}`
    : h.mode === 'review'
      ? `review ${log.dim('(no source: notes, page changes, Live candidates as page changes)')}`
      : 'source'
  process.stderr.write(
    [
      `  Open     ${log.bold(h.appUrl)}  ${log.dim(`→ ${target.href}`)}`,
      `  History  ${h.controlUrl}/__ph/history`,
      `  Project  ${project}`,
      `  Mode     ${modeLine}`,
      ...(h.noAgent ? [] : [`  Agents   ${agentLine}`]),
      ...(h.shareUrl ? [`  Share    ${log.bold(h.shareUrl)}  ${log.dim('(teammates on your network join as reviewers: comment, reply, approve; they cannot run the agent)')}`] : []),
      ...(!h.noAgent && !h.shareUrl && !LOCAL_HOSTS.has(host)
        ? [`  ${log.bold('Warning')}  listening on ${host} without --share: anyone who can reach these ports gets full control, including running the agent. Use --share to give others reviewer access only.`]
        : []),
      ...(h.noAgent && !LOCAL_HOSTS.has(host)
        ? [`  ${log.bold('Warning')}  listening on ${host}: anyone who can reach the control port can read and write review notes.`]
        : []),
      '',
    ].join('\n'),
  )
  if (values.open) openBrowser(h.appUrl)
  installShutdown(h)
}

function schemeOf(raw: string | undefined): 'http' | 'https' {
  const s = raw ?? 'http'
  if (s !== 'http' && s !== 'https') throw new Error('--public-scheme must be http or https')
  return s
}

export function publicHostOf(raw: string | undefined): string | undefined {
  const s = raw?.trim()
  if (!s) return undefined
  if (s.includes('://') || s.includes('/')) throw new Error('--public-host must be a hostname or IP address, without scheme or port')
  const bare = s.replace(/^\[|\]$/g, '')
  if (net.isIP(bare) === 6 && (s.startsWith('[') || bare.includes(':'))) return `[${bare.toLowerCase()}]`
  if (net.isIP(s) === 4) return s
  if (s.includes(':') || !/^[A-Za-z0-9.-]+$/.test(s)) throw new Error('--public-host must be a hostname or IP address, without scheme or port')
  return s.toLowerCase()
}

export function embedOriginsOf(raw: string[] | undefined): string[] | undefined {
  if (!raw?.length) return undefined
  return raw.map((s) => {
    let u: URL
    try {
      u = new URL(s.trim())
    } catch {
      throw new Error(`--embed-origin must be an origin like http://localhost:3080, got "${s}"`)
    }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== s.trim().replace(/\/$/, '')) throw new Error(`--embed-origin must be an origin like http://localhost:3080, got "${s}"`)
    return u.origin
  })
}

function printReady(h: Awaited<ReturnType<typeof startHarness>>, project: string, target?: URL) {
  const ready = {
    event: 'ready',
    version: version(),
    pid: process.pid,
    appUrl: h.appUrl,
    controlUrl: h.controlUrl,
    shareUrl: h.shareUrl ?? null,
    mode: h.mode,
    noAgent: h.noAgent,
    project,
    target: target?.href ?? null,
    ...(h.embedToken ? { embedToken: h.embedToken } : {}),
  }
  process.stdout.write(JSON.stringify(ready) + '\n')
}

function installShutdown(h: { close(): Promise<void> }) {
  let closing = false
  const shutdown = async () => {
    if (closing) return process.exit(0)
    closing = true
    log.info('shutting down…')
    await h.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('exit', () => {
    killAllAgents()
    releaseAllCursorMcp()
  })
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

const isEntry = (() => {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
})()

if (isEntry || process.env.PH_CLI === '1') {
  main().catch((e) => {
    log.error(e instanceof Error ? e.message : String(e))
    releaseAllCursorMcp()
    process.exit(1)
  })
}
