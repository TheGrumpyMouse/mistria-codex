import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { consola } from 'consola'
import { CACHE_DIR } from './paths.js'

/**
 * Who we are, so a wiki admin who wants to complain can find us.
 *
 * Two things were wrong with the previous string and both mattered. It ended in
 * `node-fetch`, which wiki.gg's rate limiter treats as a signal in its own right
 * — measured, the same requests a second apart got 8/8 without it and 4/8 with
 * it. And the URL it gave did not exist, so the one purpose a User-Agent has
 * beyond identification was not served.
 *
 * That second fault then came back a second time, under a stale account name,
 * and went unnoticed for as long as it did because nothing can detect it:
 * **a dead URL in a string fails no test and no build.** Check this against
 * `git remote -v` whenever the account or the repository name changes — this
 * line is how a wiki.gg admin reaches whoever is making the requests.
 */
const USER_AGENT =
  'mistria-codex/0.1 (+https://github.com/TheGrumpyMouse/mistria-codex; unofficial fan project)'

let lastRequestAt = 0

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetch with a disk cache and a throttle.
 *
 * The cache makes re-runs incremental, which matters because a full ingest is
 * thousands of rows across a dozen tables and nobody should re-download all of
 * it to fix one parser bug. The throttle exists because wiki.gg is a volunteer
 * community resource and this is a fan project — being impolite to it is both
 * rude and the fastest route to being blocked.
 *
 * CI never calls this. `sources/` is committed precisely so builds are hermetic.
 */
export async function fetchWithCache(
  url: string,
  { throttleMs = 400, useCache = true }: { throttleMs?: number; useCache?: boolean } = {},
): Promise<string> {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 32)
  const cachePath = join(CACHE_DIR, `${key}.txt`)

  if (useCache) {
    try {
      return await readFile(cachePath, 'utf8')
    } catch {
      // not cached — fall through and fetch
    }
  }

  const text = await fetchWithRetry(url, throttleMs)
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cachePath, text, 'utf8')
  return text
}

/** Statuses worth waiting out rather than failing on. */
const RETRYABLE = new Set([429, 502, 503, 504])
/**
 * Eight attempts, backing off to at most two minutes.
 *
 * Five attempts topping out at sixteen seconds was not enough: wiki.gg's rate
 * limiter puts a client in a penalty box for longer than that, so a long run
 * would exhaust its retries and die while the server was still saying "wait".
 * The right answer to being told to slow down is to slow down.
 */
const MAX_ATTEMPTS = 8
const MAX_BACKOFF_MS = 120_000

/**
 * Fetch with throttling and backoff.
 *
 * GiftPrefs alone is 5,328 rows — eleven sequential requests — and wiki.gg
 * rate-limits that. Since every page already fetched is on disk, a retry
 * resumes almost free; failing the whole run because request ten got a 429
 * would just mean re-running it by hand.
 *
 * `Retry-After` is honoured when present: the server knows better than we do.
 */
async function fetchWithRetry(url: string, throttleMs: number): Promise<string> {
  return await (await fetchResponse(url, throttleMs)).text()
}

/**
 * One throttled, retrying request.
 *
 * Split out from `fetchWithRetry` so binary fetches share the *same* throttle:
 * `lastRequestAt` is module state, so a sprite download and a page read take
 * turns rather than each politely waiting a second while the other hammers the
 * wiki. Two independent throttles are the same as none.
 */
async function fetchResponse(url: string, throttleMs: number): Promise<Response> {
  let attempt = 0

  for (;;) {
    const waitFor = lastRequestAt + throttleMs - Date.now()
    if (waitFor > 0) await sleep(waitFor)
    lastRequestAt = Date.now()

    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
    if (response.ok) return response

    attempt += 1
    if (!RETRYABLE.has(response.status) || attempt >= MAX_ATTEMPTS) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`)
    }

    const retryAfter = Number(response.headers.get('retry-after'))
    const backoff = Math.min(
      MAX_BACKOFF_MS,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : throttleMs * 2 ** attempt,
    )

    consola.warn(
      `${response.status} from the wiki — waiting ${Math.round(backoff / 1000)}s ` +
        `(attempt ${attempt}/${MAX_ATTEMPTS - 1})`,
    )
    await sleep(backoff)
  }
}

/**
 * Fetch a binary body, throttled and retried like everything else.
 *
 * Deliberately **not** disk-cached. `fetchWithCache` exists so a parser bug does
 * not mean re-downloading thousands of pages; a sprite has no parser to get
 * wrong, and it is already saved to `assets/game/` where the fetcher checks for
 * it. Caching it as well would mean two copies of every game asset on disk, one
 * of them outside the single directory that makes takedown a one-liner.
 */
export async function fetchBinary(
  url: string,
  { throttleMs = 1000 }: { throttleMs?: number } = {},
): Promise<Buffer> {
  const response = await fetchResponse(url, throttleMs)
  return Buffer.from(await response.arrayBuffer())
}

/** Fetch and parse JSON, failing with the response body when it isn't JSON. */
export async function fetchJson<T = unknown>(
  url: string,
  options?: { throttleMs?: number; useCache?: boolean },
): Promise<T> {
  const text = await fetchWithCache(url, options)
  try {
    return JSON.parse(text) as T
  } catch {
    // A MediaWiki error arrives as an HTML page with a 200, so surfacing the
    // first part of the body is the only way to see what actually went wrong.
    consola.error(`Non-JSON response from ${url}`)
    throw new Error(`expected JSON, got: ${text.slice(0, 300)}`)
  }
}
