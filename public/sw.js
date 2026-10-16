// Zenkai service worker: makes the site installable and lets the app shell open instantly and offline.
// It caches only the shell (index.html + its entry assets) and hashed /assets/*. Everything else goes
// to the network untouched: /api, /proxy, media, other origins, POST and range requests, the password gate.

// Stamped per build by vite.config.ts (zenkaiSw), so every deploy installs a new worker and offers a reload.
const VERSION = '__BUILD__'
const SHELL = `zenkai-shell-${VERSION}`
const ASSETS = `zenkai-assets-${VERSION}`
const SHELL_URL = '/' // every route serves the same index.html; '/' because Pages redirects /index.html
// Code of the pages the installed app launches into (start_url + shortcuts), filled in by the build.
const LAUNCH = '__LAUNCH__'

// Never touched: the API and proxy, the self-host password gate, and anything that looks like media.
const BYPASS = /^\/(api\/|proxy|login|logout)/
const MEDIA = /\.(m3u8|m3u|ts|m4s|mp4|m4a|aac|webm|mkv|key|vtt|srt|ass)$/i
// The self-host gate's sign-in / sign-out pages: reaching one means no valid session, so drop what we cached.
const SIGNED_OUT = /^\/(login|logout)$/
// Survives forget(): a unix-ms timestamp of the latest sign-out. Version cleanup must keep it too.
const META = 'zenkai-meta'
const SIGNED_OUT_AT = '/__zenkai/signed-out-at'
// Shared with a worker installing or retiring beside this one; cache writes and forget() cannot interleave.
// ponytail: no Web Locks (older Safari / WebViews) -> serialise within this worker only, rather than throwing
let chain = Promise.resolve()
const lock = (fn) => {
  if (self.navigator.locks) return navigator.locks.request('zenkai', fn)
  const run = chain.then(fn)
  chain = run.catch(() => {})
  return run
}
const wallNow = () => performance.timeOrigin + performance.now()

const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html')
// A same-origin, non-redirected 200. Redirected = the gate (or some other login) answered instead of the app.
const clean = (res) => res && res.ok && res.type === 'basic' && !res.redirected

async function signedOutAt() {
  const hit = await caches.match(SIGNED_OUT_AT, { cacheName: META })
  return hit ? Number(await hit.text()) : 0
}

// `started` is the unix ms the request began. A write from before the latest sign-out would reopen
// caches forget() just deleted, so it is dropped. The lock keeps that check and the write atomic.
async function retain(started, fn) {
  return lock(async () => (started <= (await signedOutAt()) ? null : fn()))
}

/** Stores res as the shell only if it really is the app (not a login page or an error page). */
async function putShell(res, started) {
  if (!clean(res) || !isHtml(res)) return null
  const html = await res.text()
  if (!html.includes('<div id="root">')) return null
  return retain(started, async () => {
    const cache = await caches.open(SHELL)
    await cache.put(SHELL_URL, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
    return html
  })
}

async function putAsset(cache, req, res) {
  // Hosts answer an unknown path with index.html (SPA fallback); never pin that as a script.
  if (clean(res) && !isHtml(res)) await cache.put(req, res)
}

/** Caches the shell's entry assets plus the launch pages' code, fetching only what is missing. */
async function precache(html, started) {
  const entry = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
  const urls = [...new Set([...entry, ...(Array.isArray(LAUNCH) ? LAUNCH : [])])]
  // Network stays outside the lock so a slow asset cannot delay forget() past the sign-out.
  const missing = []
  const admitted = await retain(started, async () => {
    const cache = await caches.open(ASSETS)
    await Promise.all(urls.map(async (u) => (await cache.match(u)) || missing.push(u)))
    return true
  })
  if (!admitted || !missing.length) return
  // Each body is read as soon as it arrives: an unread response keeps its HTTP/1.1 connection busy, and with
  // six per host, waiting for every response before reading any stalls the install for good.
  // One dropped request must not throw away the rest, so a failure just leaves that file out.
  const files = await Promise.all(
    missing.map(async (u) => {
      const res = await fetch(u).catch(() => null)
      if (!clean(res) || isHtml(res)) return [u, null] // isHtml: a host's SPA fallback, never pin it as a script
      const body = await res.blob().catch(() => null)
      return [u, body && new Response(body, { headers: res.headers })]
    }),
  )
  await retain(started, async () => {
    const cache = await caches.open(ASSETS)
    await Promise.all(files.map(([u, res]) => res && cache.put(u, res)))
  })
  // Launch pages are best-effort (fetched again on a later visit); without its entry JS/CSS the shell can't
  // start offline, so that fails the install and it retries next visit.
  if (files.some(([u, res]) => entry.includes(u) && !res)) throw new Error('entry assets unavailable')
}

const forget = () => lock(async () => {
  const cache = await caches.open(META)
  // Stamp before deleting, so a write that takes the lock afterwards sees the sign-out and bails.
  await cache.put(SIGNED_OUT_AT, new Response(String(wallNow())))
  for (const key of await caches.keys()) if (key.startsWith('zenkai-') && key !== META) await caches.delete(key)
})

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const started = wallNow()
      const html = await putShell(await fetch(SHELL_URL, { cache: 'no-cache' }), started)
      if (!html) throw new Error('shell unavailable') // no usable shell: don't install, retry on the next visit
      await precache(html, started)
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('zenkai-') && key !== SHELL && key !== ASSETS && key !== META) await caches.delete(key)
      // A session that ended while this worker installed (sign-out, expiry) must not leave the private shell behind.
      const probe = await fetch(SHELL_URL, { redirect: 'manual', cache: 'no-store' }).catch(() => null)
      if (probe?.type === 'opaqueredirect') await forget()
      // Navigation preload runs the network request in parallel with worker start-up, so network-first costs nothing.
      await self.registration.navigationPreload?.enable()
      await self.clients.claim()
    })(),
  )
})

// The page sends this when the user taps "Reload" on the update toast.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = new URL(req.url)
  // Signed out (or the session expired): the cached private shell and assets must not outlive it.
  // Not intercepted; the next signed-in navigation caches everything again.
  if (req.mode === 'navigate' && url.origin === self.location.origin && SIGNED_OUT.test(url.pathname)) event.waitUntil(forget())
  if (url.origin !== self.location.origin || BYPASS.test(url.pathname) || MEDIA.test(url.pathname)) return

  if (req.mode === 'navigate') event.respondWith(navigate(event))
  else if (url.pathname.startsWith('/assets/')) event.respondWith(asset(event))
  // Anything else (icons, manifest, public files, this worker) is left to the browser.
})

/** Network first, so the gate, redirects and fresh deploys behave exactly as without a worker; shell when offline. */
async function navigate(event) {
  // timeStamp is when this navigation began, so it is earlier than a sign-out that lands while the response is in flight.
  const started = performance.timeOrigin + event.timeStamp
  try {
    const res = (await event.preloadResponse) || (await fetch(event.request))
    if (clean(res) && isHtml(res)) event.waitUntil(putShell(res.clone(), started).then((html) => html && precache(html, started)))
    return res
  } catch {
    return (await caches.match(SHELL_URL, { cacheName: SHELL })) || offline()
  }
}

/** Hashed file names never change content, so cache first. */
async function asset(event) {
  const started = performance.timeOrigin + event.timeStamp
  // caches.match never creates a cache, so reads need no lock (and can't recreate one after sign-out).
  const hit = await caches.match(event.request, { cacheName: ASSETS })
  if (hit) return hit
  const res = await fetch(event.request)
  // Clone before the lock: respondWith gives this body to the page, and a later clone() throws.
  const copy = res.clone()
  // Stored only while a shell is cached (a signed-in navigation since the last sign-out): after a sign-out
  // a stale tab still gets assets, from the HTTP cache, without the gate being asked.
  event.waitUntil(retain(started, async () => (await caches.has(SHELL)) && putAsset(await caches.open(ASSETS), event.request, copy)))
  return res
}

function offline() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zenkai</title><meta name="theme-color" content="#050506"><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050506;color:#f5f5f7;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;text-align:center}
h1{margin:0 0 6px;font-size:24px;letter-spacing:-.02em}h1 span{color:#e8294c}p{margin:0 0 20px;color:#a1a1aa;font-size:14px}
button{padding:12px 22px;border:0;border-radius:999px;background:#e8294c;color:#fff;font:inherit;font-weight:600;cursor:pointer}
</style></head><body><main><h1>Zen<span>kai</span></h1><p>You are offline. Connect to the internet and try again.</p>
<button onclick="location.reload()">Try again</button></main></body></html>`
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}
