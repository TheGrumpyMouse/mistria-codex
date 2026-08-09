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
  // The guide's index files. Without these they fall to octet-stream, which a
  // browser downloads instead of rendering — and, more to the point, a sitemap
  // served as octet-stream is one Search Console will not read.
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
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
  // A directory serves its own index.html, which is how Pages resolves
  // `/guide/fish/cave-eel/` — and how the static guide is addressed at all.
  // Without this every guide URL fell through to the SPA fallback below and
  // returned the app shell, which looks like a working site and is not one.
  if (existsSync(file) && statSync(file).isDirectory()) {
    const index = join(file, 'index.html')
    if (existsSync(index)) file = index
  }

  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Mirror GitHub Pages: a missing *file* is a real 404 — the app's
    // stale-version heal depends on seeing it. Only extension-less paths get
    // the SPA fallback.
    if (extname(url.pathname) !== '') {
      res.writeHead(404).end('not found')
      return
    }
    // Pages serves 404.html here — with HTTP 404, not 200. The workflow makes
    // that file by copying index.html, so the body is the app either way; the
    // status is the part that matters, and serving 200 for a path that does
    // not exist would let a spec "pass" against a page nobody can reach.
    const fallback = join(DIST, '404.html')
    res.writeHead(404, { 'content-type': TYPES['.html'] })
    createReadStream(existsSync(fallback) ? fallback : join(DIST, 'index.html')).pipe(res)
    return
  }

  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(PORT, () => console.log(`serving dist at http://localhost:${PORT}${PREFIX}`))
