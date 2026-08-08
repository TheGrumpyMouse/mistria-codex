/**
 * `pnpm e2e` — serve `dist/` at the production base path and run every spec.
 *
 * Deliberately not in CI: it needs a production build, a data bundle and a
 * Chromium, and CI stays hermetic. It is the local gate before shipping UI
 * changes — see apps/web/CLAUDE.md.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const dist = join(here, '..', 'dist')

if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'data', 'meta.json'))) {
  console.error(
    'e2e: apps/web/dist is missing or has no data bundle. Build first:\n' +
      '  pnpm build:ship\n' +
      '  BASE_PATH=/mistria-codex/ pnpm build:web   (PowerShell: $env:BASE_PATH=...)',
  )
  process.exit(1)
}

const server = spawn(process.execPath, [join(here, 'serve.mjs')], { stdio: 'ignore' })
await new Promise((resolve) => setTimeout(resolve, 800))

let failed = 0
try {
  const specs = readdirSync(here)
    .filter((f) => f.endsWith('.spec.mjs'))
    .sort()
  for (const spec of specs) {
    console.log(`\n══════ ${spec} ══════`)
    const result = spawnSync(process.execPath, [join(here, spec)], { stdio: 'inherit' })
    if (result.status !== 0) failed += 1
  }
} finally {
  server.kill()
}

console.log(failed === 0 ? '\ne2e: all specs green' : `\ne2e: ${failed} spec(s) failed`)
process.exit(failed === 0 ? 0 : 1)
