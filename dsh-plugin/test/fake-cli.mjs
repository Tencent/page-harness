// Stands in for dist/cli.js. FAKE_MODE: ready (default) | crash | silent.
const args = process.argv.slice(2)
const mode = process.env.FAKE_MODE ?? 'ready'
const opt = (name) => args[args.indexOf(name) + 1]

if (mode === 'crash') {
  process.stderr.write('error: port 17990 is already in use\n')
  process.exit(1)
}
if (mode === 'ready') {
  const port = Number(opt('--port'))
  const host = opt('--public-host') ?? '192.168.1.20'
  process.stdout.write('not json\n')
  process.stdout.write(JSON.stringify({
    event: 'ready',
    version: '0.0.0-test',
    pid: process.pid,
    appUrl: `http://localhost:${port}`,
    controlUrl: `http://localhost:${port + 1}`,
    shareUrl: `http://${host}:${port + 1}/__ph/join?t=abc`,
    mode: 'review',
    noAgent: args.includes('--no-agent'),
    args,
  }) + '\n')
}
setInterval(() => {}, 1000)
