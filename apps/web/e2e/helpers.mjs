/**
 * The tiny harness every spec shares.
 *
 * playwright-core only — the suite reuses a Chromium the machine already has
 * (or the one `npx playwright install chromium` puts in the default cache)
 * rather than adding a browser download to every install.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

export const BASE = `http://localhost:${process.env.PORT ?? 4173}/mistria-codex/`

/** Any Chromium already in the Playwright cache, newest revision first. */
function cachedChromium() {
  const roots =
    process.platform === 'win32'
      ? [join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')]
      : process.platform === 'darwin'
        ? [join(homedir(), 'Library', 'Caches', 'ms-playwright')]
        : [join(homedir(), '.cache', 'ms-playwright')]
  const leaves =
    process.platform === 'win32'
      ? ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']
      : process.platform === 'darwin'
        ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium']
        : ['chrome-linux/chrome']

  for (const root of roots) {
    let dirs = []
    try {
      dirs = readdirSync(root).filter((d) => d.startsWith('chromium-'))
    } catch {
      continue
    }
    for (const dir of dirs.sort().reverse()) {
      for (const leaf of leaves) {
        const path = join(root, dir, ...leaf.split('/'))
        if (existsSync(path)) return path
      }
    }
  }
  return null
}

/**
 * Chromium, wherever it lives: PLAYWRIGHT_CHROMIUM overrides, then the exact
 * revision this playwright-core wants, then any cached revision (the API is
 * stable enough for these tests), then a fresh install as the last resort.
 */
function executablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  try {
    const exact = chromium.executablePath()
    if (existsSync(exact)) return exact
  } catch {
    /* fall through */
  }
  const cached = cachedChromium()
  if (cached !== null) return cached
  execSync('npx playwright-core install chromium', { stdio: 'inherit' })
  return chromium.executablePath()
}

export async function launch() {
  return chromium.launch({ executablePath: executablePath(), headless: true })
}

export function makeChecker() {
  const problems = []
  const results = []
  const check = (label, ok, detail = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
    if (!ok) problems.push(`ASSERT ${label}`)
  }
  const watch = (page) => {
    page.on('pageerror', (e) => problems.push(`PAGEERROR: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`CONSOLE: ${m.location()?.url ?? ''} ${m.text()}`)
    })
  }
  const finish = () => {
    console.log(results.join('\n'))
    console.log('\n────── problems ──────')
    console.log(problems.length === 0 ? 'none' : [...new Set(problems)].join('\n'))
    process.exitCode = problems.length === 0 ? 0 : 1
  }
  return { check, watch, finish, problems }
}

/** The tour is real UI that sits over everything on a fresh profile. */
export const dismissTour = (page) =>
  page.addInitScript(() => localStorage.setItem('mistria-codex:tour', 'done'))
