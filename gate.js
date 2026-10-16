// Site-wide password gate for the self-hosted server (serve.js). Set SITE_PASSWORD in .env to turn it on.
// A correct password sets a 30-day HttpOnly cookie; changing SITE_PASSWORD signs everyone out.
import { createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE = 'zk_gate'
const MAX_AGE = 30 * 24 * 3600
// [max failed attempts, per window ms] per IP
const FAIL_LIMIT = [10, 15 * 60 * 1000]

const fails = new Map()
const cookieValue = (password) => createHmac('sha256', password).update('zenkai-gate:v1').digest('hex')

function safeEq(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return ''
}

const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/')

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const page = (next, error) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Zenkai</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0c0f;color:#f4f4f5;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
form{width:100%;max-width:340px;background:#17171b;border:1px solid #26262c;border-radius:16px;padding:28px}
h1{margin:0 0 4px;font-size:24px;letter-spacing:-.02em}h1 span{color:#e8294c}
p{margin:0 0 20px;color:#a1a1aa;font-size:14px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #33333a;background:#0c0c0f;color:inherit;font:inherit;outline:none}
input:focus{border-color:#e8294c}
button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#e8294c;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:#f87171;font-size:14px;margin:10px 0 0}
</style></head><body>
<form method="post" action="/login">
<h1>Zen<span>kai</span></h1><p>This site is private. Enter the password to continue.</p>
<input type="hidden" name="next" value="${esc(next)}">
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
<button type="submit">Enter</button>
${error ? `<p class="err">${esc(error)}</p>` : ''}
</form></body></html>`

function sendPage(res, status, next, error) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(page(next, error))
}

async function readForm(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 4096) break
  }
  return new URLSearchParams(body)
}

/**
 * Returns true when the request was answered here (login page, redirect, block),
 * false when it is signed in and should continue.
 */
export async function gate(req, res, ip) {
  const password = process.env.SITE_PASSWORD
  if (!password) return false
  const expected = cookieValue(password)
  const url = new URL(req.url ?? '/', 'http://x')

  if (url.pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('User-agent: *\nDisallow: /\n')
    return true
  }

  if (url.pathname === '/login') {
    if (req.method !== 'POST') {
      sendPage(res, 200, safeNext(url.searchParams.get('next')))
      return true
    }
    const now = Date.now()
    const f = fails.get(ip)
    if (f && now < f.reset && f.n >= FAIL_LIMIT[0]) {
      sendPage(res, 429, '/', 'Too many attempts. Try again in a few minutes.')
      return true
    }
    const form = await readForm(req)
    const next = safeNext(form.get('next'))
    if (safeEq(form.get('password') ?? '', password)) {
      fails.delete(ip)
      res.writeHead(303, {
        Location: next,
        'Set-Cookie': `${COOKIE}=${expected}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store',
      })
      res.end()
      return true
    }
    if (!f || now > f.reset) fails.set(ip, { n: 1, reset: now + FAIL_LIMIT[1] })
    else f.n++
    await new Promise((r) => setTimeout(r, 800))
    sendPage(res, 401, next, 'Wrong password.')
    return true
  }

  if (url.pathname === '/logout') {
    res.writeHead(303, { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` })
    res.end()
    return true
  }

  if (safeEq(readCookie(req, COOKIE), expected)) return false

  if (url.pathname.startsWith('/api/') || url.pathname === '/proxy') {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end('{"error":"Sign in required"}')
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    res.writeHead(302, { Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' })
    res.end()
  } else {
    res.writeHead(401)
    res.end()
  }
  return true
}
