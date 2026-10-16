// Self-hosted production server: serves dist/ and runs /api/* + /proxy through the same
// handler Cloudflare Pages Functions use. Build first with `npm run build:selfhost`.
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { handle } from './dist-server/handler.js'
import { gate } from './gate.js'

try {
  process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)))
} catch {}

const ROOT = fileURLToPath(new URL('./dist/', import.meta.url))
const PORT = Number(process.env.PORT) || 4180
const HOST = process.env.HOST || '0.0.0.0'

// Only trust the proxy's X-Real-IP when the request comes from a private address (NPM on the
// Docker bridge); otherwise use the socket address so clients can't spoof their IP past the shield.
const PRIVATE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$)/
function clientIp(req) {
  const peer = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  const real = req.headers['x-real-ip']
  return PRIVATE.test(peer) && typeof real === 'string' && real ? real : peer
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}

async function sendFile(res, file, method) {
  const s = await stat(file).catch(() => null)
  if (!s?.isFile()) return false
  const hashed = file.includes(`${join(ROOT, 'assets')}`)
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': s.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (method === 'HEAD') res.end()
  else createReadStream(file).pipe(res)
  return true
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/'
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  try {
    if (await gate(req, res, clientIp(req))) return
    if (url.startsWith('/api/') || url.startsWith('/proxy')) {
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
      headers.delete('cf-connecting-ip')
      headers.set('x-forwarded-for', clientIp(req))
      const proto = req.headers['x-forwarded-proto'] ?? 'http'
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req)
      const out =
        (await handle(new Request(`${proto}://${req.headers.host}${url}`, { method: req.method, headers, body, duplex: 'half' }), {
          SHIELD_SECRET: process.env.SHIELD_SECRET,
          GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        })) ?? new Response('Not found', { status: 404 })
      res.writeHead(out.status, Object.fromEntries(out.headers))
      if (out.body && req.method !== 'HEAD') Readable.fromWeb(out.body).pipe(res)
      else res.end()
      return
    }

    const path = normalize(decodeURIComponent(url.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
    const file = join(ROOT, path)
    if (file.startsWith(ROOT) && (await sendFile(res, file, req.method))) return
    // SPA fallback
    await sendFile(res, join(ROOT, 'index.html'), req.method)
  } catch (e) {
    console.error(e)
    if (!res.headersSent) res.writeHead(500)
    res.end('Internal error')
  }
})

// At boot the Docker bridge address may not exist yet, so keep retrying until it does.
server.on('error', (e) => {
  if (e.code !== 'EADDRNOTAVAIL') throw e
  console.warn(`${HOST} not available yet, retrying in 3s`)
  setTimeout(() => server.listen(PORT, HOST), 3000)
})
server.listen(PORT, HOST, () => console.log(`Zenkai listening on http://${HOST}:${PORT}`))
