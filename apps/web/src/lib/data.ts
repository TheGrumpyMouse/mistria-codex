/**
 * Loading the shipped dataset.
 *
 * Two things shape this and both come from GitHub Pages. It sends fixed
 * response headers, so a dataset's version lives in its **URL** rather than in
 * a cache directive — `meta.json` sits at a stable path and names the versioned
 * directory everything else is under. And it serves the site from `/<repo>/`,
 * so every URL is built from `import.meta.env.BASE_URL`; a leading slash works
 * in dev and 404s in production.
 *
 * Datasets are fetched one at a time, on demand. `items.json` alone is several
 * hundred kilobytes and parsing it on the main thread freezes a mid-range phone
 * with no spinner, because React cannot paint either — so a screen asks for
 * what it needs and nothing else.
 */
import type { Meta } from '@mistria/schema'
import type { AvailabilityIndex } from './findable'
import type { RequestBoard } from './request-board'

/** In-flight and settled requests, so two components asking do not fetch twice. */
const pending = new Map<string, Promise<unknown>>()

class HttpError extends Error {
  constructor(
    url: string,
    readonly status: number,
    statusText: string,
  ) {
    super(`${url}: ${status} ${statusText}`)
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new HttpError(url, response.status, response.statusText)
  return (await response.json()) as T
}

/**
 * The manifest, revalidated rather than cached.
 *
 * This is the one file whose contents change at a fixed URL, so it is the one
 * file that must not be served from cache. Everything it points at is
 * content-addressed and can be cached forever.
 */
const META_URL = `${import.meta.env.BASE_URL}data/meta.json`

export function loadMeta(): Promise<Meta> {
  const existing = pending.get(META_URL)
  if (existing !== undefined) return existing as Promise<Meta>

  const request = fetchJson<Meta>(META_URL, { cache: 'no-store' })
  pending.set(META_URL, request)
  return request
}

/**
 * Fetch a file under the versioned data directory, healing a stale version.
 *
 * The site can redeploy while a session is open, and only the **new** version
 * directory exists on the server — the old one is gone, so a dataset this
 * session never touched 404s even though everything else still works (the
 * service worker keeps already-cached files alive under their old URLs). A 404
 * here therefore re-reads `meta.json` once and retries at the version it now
 * names. Anything else — offline, a server hiccup — is rethrown untouched:
 * retrying those would just double every failure.
 */
async function fetchVersioned<T>(name: string): Promise<T> {
  const meta = await loadMeta()
  const url = `${import.meta.env.BASE_URL}data/v/${meta.dataVersion}/${name}`

  const existing = pending.get(url)
  if (existing !== undefined) return existing as Promise<T>

  const request = fetchJson<T>(url).catch(async (error: unknown) => {
    if (!(error instanceof HttpError) || error.status !== 404) throw error
    pending.delete(url)

    // Straight to the network: the service worker serves meta.json
    // stale-while-revalidate, and the stale copy is the very thing being
    // corrected. The query string dodges its cache without a new route.
    let fresh: Meta
    try {
      fresh = await fetchJson<Meta>(`${META_URL}?fresh=${Date.now()}`, { cache: 'no-store' })
    } catch {
      throw error
    }
    if (fresh.dataVersion === meta.dataVersion) throw error

    // Adopt the newer manifest so every later load starts at the right place.
    pending.set(META_URL, Promise.resolve(fresh))
    return fetchJson<T>(`${import.meta.env.BASE_URL}data/v/${fresh.dataVersion}/${name}`)
  })
  pending.set(url, request)
  return request
}

/**
 * One dataset, by name.
 *
 * The URL is `BASE_URL` + the version from `meta.json`, **not** `meta.basePath`.
 * That field is written at ship time from an environment variable naming the
 * production path, so it is right on Pages and wrong everywhere else — in dev
 * it sends the request to `/mistria-codex/...`, which returns `index.html` and
 * fails as "Unexpected token '<'". Composing the two halves at the point of use
 * is correct in both places and needs nothing configured.
 */
export async function loadDataset<T>(name: string): Promise<T[]> {
  return await fetchVersioned<T[]>(`${name}.json`)
}

/**
 * The request board — a shipped form, not a dataset.
 *
 * It is joined at build time so this screen does not pull a megabyte of items
 * to print 193 names. 61KB against 1MB.
 */
export async function loadRequestBoard(): Promise<RequestBoard> {
  return await fetchVersioned<RequestBoard>('request_board.json')
}

/** `id -> { n: name, i: icon_key, c: category }`, for painting a result row. */
export type DisplayIndex = Record<
  string,
  {
    n: string
    i: string | null
    c: string
    v: number | null
    /** 1 when the record is a story spoiler — list rows veil the name. */
    s?: 1
    /**
     * Spoiler aliases — names that are themselves the reveal ("Seridia").
     * Searchable like `a`, but shown only to someone who typed them.
     */
    sa?: string[]
    /**
     * Other names this thing goes by, searchable but never shown as the name.
     * Absent on almost every entry, so read it as optional rather than empty.
     */
    a?: string[]
  }
>

/**
 * The display index and the availability index.
 *
 * Both are small on purpose — 92KB and 119KB — and together they are everything
 * the Today screen needs. The alternative is `items.json` at a megabyte, which
 * is the parse that freezes a mid-range phone with no spinner.
 */
export async function loadDisplayIndex(): Promise<DisplayIndex> {
  return await loadShipped<DisplayIndex>('index.json')
}

export async function loadAvailability(): Promise<AvailabilityIndex> {
  return await loadShipped<AvailabilityIndex>('availability.json')
}

async function loadShipped<T>(file: string): Promise<T> {
  return await fetchVersioned<T>(file)
}

/** Drop every cached response. Only for tests. */
export function resetDataCache(): void {
  pending.clear()
}
