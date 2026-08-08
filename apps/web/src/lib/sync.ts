import { generateCode, parseCode } from '@mistria/sync-client'
import { allProgress, applyMerged, mergeProgress, type ProgressRow } from './progress'

/**
 * The client half of sync: pull, merge, push.
 *
 * **The merge lives here and not in the Worker**, which is what makes the
 * server a dumb blob store with an etag. One property-tested implementation,
 * fixable by shipping the app rather than by redeploying.
 *
 * The whole exchange is three steps and no account:
 *
 * 1. `GET` the blob for the code, with its etag.
 * 2. Merge it into the local table — commutative, so order never matters.
 * 3. `PUT` the result back `If-Match` that etag. A 409 comes back **with the
 *    current blob**, so a conflict costs one extra round trip, not two.
 *
 * A push is skipped entirely when the merge produced exactly what the server
 * already had. That is not an optimisation: the free tier allows 1,000 KV
 * writes a day, and a client that wrote on every sync would spend them storing
 * bytes that already match.
 */

/** Where the Worker lives. Unset in a build that has no sync deployed. */
const ENDPOINT: string | undefined = import.meta.env.VITE_SYNC_URL

/** localStorage, not IndexedDB: it is one short string and it is read on boot. */
const CODE_KEY = 'mistria-codex:sync-code'
const LAST_KEY = 'mistria-codex:sync-at'

/** The row shape the Worker stores. Bumped together with the Worker's copy. */
const SCHEMA_VERSION = 1

interface Blob {
  schemaVersion: number
  rows: ProgressRow[]
}

export const syncConfigured = (): boolean => typeof ENDPOINT === 'string' && ENDPOINT !== ''

export function savedCode(): string | null {
  const raw = localStorage.getItem(CODE_KEY)
  return raw === null ? null : (parseCode(raw)?.formatted ?? null)
}

/**
 * Store a code, or clear it.
 *
 * Validated before it is written — a mistyped code should fail in the settings
 * panel, not silently on every sync afterwards. The checksum makes that a local
 * check with no network call.
 */
export function saveCode(input: string | null): string | null {
  if (input === null) {
    localStorage.removeItem(CODE_KEY)
    localStorage.removeItem(LAST_KEY)
    return null
  }
  const parsed = parseCode(input)
  if (parsed === null) return null
  localStorage.setItem(CODE_KEY, parsed.formatted)
  return parsed.formatted
}

export const newCode = (): string => generateCode()

export function lastSyncedAt(): Date | null {
  const raw = localStorage.getItem(LAST_KEY)
  if (raw === null) return null
  const at = Number(raw)
  return Number.isFinite(at) ? new Date(at * 1000) : null
}

export type SyncResult =
  | { ok: true; merged: number; written: boolean }
  | { ok: false; reason: 'not_configured' | 'no_code' | 'bad_code' | 'network' | 'stale_client' }

/**
 * One full exchange. Safe to call twice; the merge is idempotent.
 *
 * Every failure is a named reason rather than a thrown error, because the
 * settings panel has to say *which* thing went wrong — "your code is wrong" and
 * "you are offline" want completely different responses from the person
 * reading, and a generic "sync failed" tells them to retry the one that will
 * never work.
 */
export async function syncNow(): Promise<SyncResult> {
  if (ENDPOINT === undefined || ENDPOINT === '') return { ok: false, reason: 'not_configured' }

  const code = savedCode()
  if (code === null) return { ok: false, reason: 'no_code' }
  const parsed = parseCode(code)
  if (parsed === null) return { ok: false, reason: 'bad_code' }

  const url = `${ENDPOINT.replace(/\/$/, '')}/v1/progress/${encodeURIComponent(parsed.formatted)}`

  try {
    const pulled = await fetch(url)
    if (pulled.status === 400) return { ok: false, reason: 'bad_code' }
    if (!pulled.ok) return { ok: false, reason: 'network' }

    const remote = (await pulled.json()) as Blob
    const etag = pulled.headers.get('etag')
    const merged = mergeProgress(await allProgress(), remote.rows ?? [])
    await applyMerged(merged)

    const push = await fetch(url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(etag === null ? {} : { 'if-match': etag }),
      },
      body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, rows: merged }),
    })

    // 426 means this build's row shape predates the Worker's. Retrying cannot
    // help and neither can merging again — the app has to be updated.
    if (push.status === 426) return { ok: false, reason: 'stale_client' }

    // The Worker answers a conflict with the current blob, so one more merge
    // and one more write settles it. Only once: a second conflict means
    // something else is writing continuously, and looping would be a spin.
    if (push.status === 409) {
      const conflict = (await push.json()) as { current?: Blob }
      const remerged = mergeProgress(merged, conflict.current?.rows ?? [])
      await applyMerged(remerged)

      const retry = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, rows: remerged }),
      })
      if (!retry.ok) return { ok: false, reason: 'network' }
      markSynced()
      return { ok: true, merged: remerged.length, written: true }
    }

    if (!push.ok) return { ok: false, reason: 'network' }

    const result = (await push.json()) as { written?: boolean }
    markSynced()
    return { ok: true, merged: merged.length, written: result.written === true }
  } catch {
    // Offline is the common case for an offline-first app, and it is not an
    // error worth a stack trace.
    return { ok: false, reason: 'network' }
  }
}

const markSynced = (): void => localStorage.setItem(LAST_KEY, String(Math.floor(Date.now() / 1000)))
