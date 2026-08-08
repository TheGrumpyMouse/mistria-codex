/**
 * A static server for the built app, mounted at the production base path.
 *
 * The point of the prefix: GitHub Pages serves this app from /<repo>/, and a
 * whole class of bug (a URL with a leading slash) only shows up under it. The
 * suite always tests what production serves — run `pnpm e2e` and it builds
 * first, or serve an existing `dist/` with `node e2e/serve.mjs`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist')
const PREFIX = '/mistria-codex/'
const PORT = Number(process.env.PORT ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith(PREFIX)) {
    res.writeHead(404).end('outside base path')
    return
  }

  let file = normalize(join(DIST, url.pathname.slice(PREFIX.length))).replace(/\\/g, '/')
  if (!file.startsWith(DIST.replace(/\\/g, '/'))) {
    res.writeHead(403).end()
    return
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Mirror GitHub Pages: a missing *file* is a real 404 — the app's
    // stale-version heal depends on seeing it. Only extension-less paths get
    // the SPA fallback.
    if (extname(url.pathname) !== '') {
      res.writeHead(404).end('not found')
      return
    }
    file = join(DIST, 'index.html')
  }

  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(PORT, () => console.log(`serving dist at http://localhost:${PORT}${PREFIX}`))
