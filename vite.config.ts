import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { defineConfig, type Plugin, type Rolldown } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Serves /api/* and /proxy in dev with the same handler Cloudflare Pages Functions use in production. */
function zenkaiApi(): Plugin {
  return {
    name: 'zenkai-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/') && !url.startsWith('/proxy')) return next()
        try {
          const { handle } = await server.ssrLoadModule('/server/handler.js')
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
          const out: Response | null = await handle(new Request(`http://${req.headers.host}${url}`, { method: req.method, headers }), { SHIELD_SECRET: process.env.SHIELD_SECRET })
          if (!out) return next()
          res.writeHead(out.status, Object.fromEntries(out.headers))
          if (out.body) Readable.fromWeb(out.body as never).pipe(res)
          else res.end()
        } catch (e) {
          res.statusCode = 500
          res.end(String(e))
        }
      })
    },
  }
}

/** Public pages for the sitemap (personal pages such as /profile and /list are left out on purpose). */
const PAGES: Array<[path: string, freq: string, priority: string]> = [
  ['/', 'weekly', '1.0'],
  ['/home', 'daily', '0.9'],
  ['/trending', 'daily', '0.8'],
  ['/popular', 'daily', '0.8'],
  ['/top', 'weekly', '0.7'],
  ['/browse', 'daily', '0.8'],
  ['/schedule', 'daily', '0.7'],
  ['/movies', 'daily', '0.9'],
  ['/movies/browse', 'daily', '0.7'],
  ['/manga', 'daily', '0.9'],
  ['/manga/browse', 'daily', '0.7'],
  ['/novel', 'daily', '0.9'],
  ['/app', 'monthly', '0.5'],
  ['/self-host', 'monthly', '0.5'],
]

/**
 * Site URL for absolute links (share image, canonical, sitemap). Set VITE_SITE_URL to your domain;
 * Cloudflare Pages / Vercel URLs are picked up automatically when it is not set.
 */
const SITE_URL = (
  process.env.VITE_SITE_URL ||
  process.env.CF_PAGES_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
  'https://zenkai.pages.dev'
).replace(/\/$/, '')

/** Fills %SITE_URL% in index.html and writes sitemap.xml + robots.txt into the build. */
function zenkaiSeo(): Plugin {
  return {
    name: 'zenkai-seo',
    transformIndexHtml: (html) => html.split('%SITE_URL%').join(SITE_URL),
    generateBundle() {
      const day = new Date().toISOString().slice(0, 10)
      const urls = PAGES.map(
        ([path, freq, pr]) =>
          `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <lastmod>${day}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pr}</priority>${path === '/' ? `\n    <image:image>\n      <image:loc>${SITE_URL}/og-image.jpg</image:loc>\n      <image:title>Zenkai: watch anime and movies, read manga and novels</image:title>\n    </image:image>` : ''}\n  </url>`,
      ).join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls}\n</urlset>\n`,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /proxy\nDisallow: /profile\nDisallow: /list\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      })
    },
  }
}

/** Pages the installed app launches into (manifest start_url + shortcuts); their code is precached for offline launch. */
const LAUNCH_PAGES = ['HomePage', 'SchedulePage', 'ListPage']

/** The launch pages' chunks with everything they statically import, CSS included, as /assets/... URLs. */
function launchAssets(bundle: Rolldown.OutputBundle): string[] {
  const out = new Set<string>()
  const add = (name: string) => {
    const c = bundle[name]
    if (c?.type !== 'chunk' || out.has(`/${name}`)) return
    out.add(`/${name}`)
    c.viteMetadata?.importedCss.forEach((css) => out.add(`/${css}`))
    c.imports.forEach(add)
  }
  for (const c of Object.values(bundle)) if (c.type === 'chunk' && LAUNCH_PAGES.some((p) => c.facadeModuleId?.replace(/\\/g, '/').endsWith(`/src/pages/${p}.tsx`))) add(c.fileName)
  return [...out]
}

/**
 * Stamps the build id into dist/sw.js (public/sw.js has '__BUILD__'), so every deploy that changes the app
 * ships a new service worker: fresh cache names and the "New version available" toast. Also fills in the
 * launch pages' assets ('__LAUNCH__').
 */
function zenkaiSw(): Plugin {
  let outDir = 'dist'
  return {
    name: 'zenkai-sw',
    apply: 'build',
    configResolved: (c) => void (outDir = resolve(c.root, c.build.outDir)),
    writeBundle(_, bundle) {
      const file = join(outDir, 'sw.js')
      if (!existsSync(file)) return // the SSR server build has no public dir
      const html = bundle['index.html']
      const id = createHash('sha256')
        .update(Object.keys(bundle).sort().join('\n'))
        .update(html?.type === 'asset' ? html.source : '')
        .digest('hex')
        .slice(0, 12)
      const launch = launchAssets(bundle)
      if (!launch.length) this.warn('no launch page chunks found for sw.js')
      writeFileSync(file, readFileSync(file, 'utf8').replace("'__BUILD__'", JSON.stringify(id)).replace("'__LAUNCH__'", JSON.stringify(launch)))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), zenkaiApi(), zenkaiSeo(), zenkaiSw()],
  server: { host: true },
})
