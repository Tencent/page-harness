// Finds dev servers running on this machine so the user can preview one while coding.
import http from 'node:http'

export const DEV_PORTS = [3000, 3001, 3002, 4000, 4173, 4200, 4321, 5000, 5173, 5174, 5175, 5500, 6006, 8000, 8008, 8080, 8081, 8888, 9000]

function probe(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs, headers: { accept: 'text/html' } }, (res) => {
      const type = String(res.headers['content-type'] ?? '')
      if (!/text\/html/i.test(type)) {
        res.resume()
        return resolve(null)
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (d) => {
        body += d
        if (body.length > 64_000) res.destroy()
      })
      const done = () => {
        const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? ''
        resolve({ port, url: `http://localhost:${port}/`, title: title.slice(0, 80) })
      }
      res.on('end', done)
      res.on('close', done)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

/** HTML servers on common dev ports, skipping ports that belong to DSH or page-harness. */
export async function detectDevServers({ exclude = [], ports = DEV_PORTS, timeoutMs = 800 } = {}) {
  const skip = new Set(exclude.map(Number))
  const found = await Promise.all(ports.filter((p) => !skip.has(p)).map((p) => probe(p, timeoutMs)))
  return found.filter(Boolean)
}
