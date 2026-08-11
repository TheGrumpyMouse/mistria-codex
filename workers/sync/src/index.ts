import { parseCode } from '@mistria/sync-client'

/**
 * The sync Worker: one progress blob per device code.
 *
 * **The merge is not here.** It runs on the client, which keeps this Worker's
 * CPU trivially under its limit, puts the CRDT in one property-tested place
 * instead of two, and means a bug in it can be fixed by shipping the app rather
 * than by redeploying a server. This endpoint is storage with an etag.
 *
 * The free tier allows **1,000 KV writes a day**, and that number shapes the
 * whole design: the client generates its own code so handing one out costs no
 * write, syncing is debounced and suppressed when the merge changed nothing,
 * and a `PUT` that would store identical bytes is answered without writing.
 *
 * **Anyone with the code can read and change that progress.** That is the price
 * of having no accounts, and the app says so in as many words rather than
 * implying it away.
 */

export interface Env {
  PROGRESS: KVNamespace
  RATE_LIMIT: { limit: (options: { key: string }) => Promise<{ success: boolean }> }
  /** Comma-separated. An allowlist, never `*`. */
  ALLOWED_ORIGINS?: string
}

/** One synced fact: `id -> ±epochSeconds`. Negative is an explicit tombstone. */
interface ProgressRow {
  key: string
  t: number
}

interface Blob {
  schemaVersion: number
  rows: ProgressRow[]
}

/** Bump when the row shape changes. An older client is told to update. */
const SCHEMA_VERSION = 1

/** A blob big enough to be a mistake. 400 progress rows is a completed game. */
const MAX_ROWS = 20_000

function corsHeaders(request: Request, env: Env): Record<string, string> {
  // An explicit allowlist. `*` on an endpoint that accepts writes lets any page
  // anyone visits alter their progress in the background.
  //
  // Trailing slashes are stripped before comparing: an Origin header is scheme
  // + host and never ends in one, and a configured `https://host/` silently
  // matching nothing is exactly how sync shipped broken — the browser blocked
  // every response and the app could only say "could not reach the server".
  const normalize = (o: string): string => o.replace(/\/+$/, '')
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => normalize(o.trim()))
    .filter(Boolean)
  const origin = normalize(request.headers.get('origin') ?? '')
  const ok = allowed.includes(origin)

  return {
    ...(ok ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    'access-control-allow-methods': 'GET,HEAD,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,if-match',
    'access-control-expose-headers': 'etag',
    'access-control-max-age': '86400',
  }
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })

/** Weak etag over the stored bytes. Cheap, and enough for optimistic writes. */
async function etagOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hex = [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `"${hex}"`
}

function parseBlob(text: string | null): Blob {
  if (text === null) return { schemaVersion: SCHEMA_VERSION, rows: [] }
  try {
    const parsed = JSON.parse(text) as Blob
    return Array.isArray(parsed.rows) ? parsed : { schemaVersion: SCHEMA_VERSION, rows: [] }
  } catch {
    return { schemaVersion: SCHEMA_VERSION, rows: [] }
  }
}

/** Reject anything that is not the row shape, rather than storing it. */
function validRows(value: unknown): value is ProgressRow[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ROWS &&
    value.every(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as ProgressRow).key === 'string' &&
        (row as ProgressRow).key.length > 0 &&
        (row as ProgressRow).key.length <= 200 &&
        Number.isFinite((row as ProgressRow).t),
    )
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(request.url)
    if (url.pathname === '/v1/health') return json({ ok: true }, { headers: cors })

    const match = /^\/v1\/progress\/(.+)$/.exec(url.pathname)
    if (match === null) return json({ error: 'not_found' }, { status: 404, headers: cors })

    // Validated before anything else touches KV: a malformed code is a typo,
    // and answering it costs nothing.
    const code = parseCode(decodeURIComponent(match[1] ?? ''))
    if (code === null) {
      return json({ error: 'bad_code' }, { status: 400, headers: cors })
    }

    // Costs no KV operations, unlike counting requests in KV itself.
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
    const { success } = await env.RATE_LIMIT.limit({ key: `${ip}:${request.method}` })
    if (!success) {
      return json({ error: 'rate_limited' }, { status: 429, headers: cors })
    }

    const key = `progress:${code.key}`

    if (request.method === 'GET' || request.method === 'HEAD') {
      const text = await env.PROGRESS.get(key)
      const blob = parseBlob(text)
      const etag = await etagOf(text ?? '')
      const headers = { ...cors, etag }
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
      return json(blob, { headers })
    }

    if (request.method === 'DELETE') {
      await env.PROGRESS.delete(key)
      return new Response(null, { status: 204, headers: cors })
    }

    if (request.method !== 'PUT') {
      return json({ error: 'method_not_allowed' }, { status: 405, headers: cors })
    }

    let incoming: Blob
    try {
      incoming = (await request.json()) as Blob
    } catch {
      return json({ error: 'bad_json' }, { status: 400, headers: cors })
    }

    // An old client's rows may not mean what this Worker thinks they do, so it
    // is told to update rather than allowed to write a shape nobody can read.
    if (incoming.schemaVersion !== SCHEMA_VERSION) {
      return json(
        { error: 'stale_schema', expected: SCHEMA_VERSION },
        { status: 426, headers: cors },
      )
    }
    if (!validRows(incoming.rows)) {
      return json({ error: 'bad_rows' }, { status: 400, headers: cors })
    }

    const current = await env.PROGRESS.get(key)
    const currentEtag = await etagOf(current ?? '')
    const ifMatch = request.headers.get('if-match')

    // **A 409 returns the current blob**, so the client merges and retries in
    // one round trip rather than two. Without the body it would have to GET
    // first, doubling the reads on exactly the contended case.
    if (ifMatch !== null && ifMatch !== currentEtag) {
      return json(
        { error: 'conflict', current: parseBlob(current) },
        { status: 409, headers: { ...cors, etag: currentEtag } },
      )
    }

    const rows = [...incoming.rows].sort((a, b) => a.key.localeCompare(b.key))
    const text = JSON.stringify({ schemaVersion: SCHEMA_VERSION, rows })

    // No-op suppression, and it is not an optimisation — it is what keeps a
    // realistic user inside 1,000 writes a day. A client that syncs on every
    // visibility change would otherwise spend a write each time to store bytes
    // that already match.
    if (text === current) {
      return json({ ok: true, written: false }, { headers: { ...cors, etag: currentEtag } })
    }

    await env.PROGRESS.put(key, text)
    return json({ ok: true, written: true }, { headers: { ...cors, etag: await etagOf(text) } })
  },
}
