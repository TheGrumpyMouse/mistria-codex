import type { Meta } from '@mistria/schema'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { useServiceWorker } from '~/app/ServiceWorkerProvider'
import { Section } from '~/components/Section'
import { loadMeta } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { allProgress, db } from '~/lib/progress'
import { useSpoilers } from '~/lib/spoilers'
import {
  lastSyncedAt,
  newCode,
  type SyncResult,
  saveCode,
  savedCode,
  syncConfigured,
  syncNow,
} from '~/lib/sync'
import {
  savedTextSize,
  setTextSize,
  TEXT_SIZE_LABELS,
  TEXT_SIZES,
  type TextSize,
} from '~/lib/text-size'
import { useTourDone } from '~/lib/tour'

/**
 * Settings: the sync code, and getting your progress off this device.
 *
 * **The warning is the feature.** There are no accounts, so the code *is* the
 * credential: anyone who has it can read and change that progress. Saying so
 * plainly, next to the code, is the only honest way to ship a system with no
 * password — burying it in the About page would be technically true and
 * practically a trap.
 *
 * A code is generated on the device and never by the server, so getting one
 * costs nothing and works offline. The second device types it in.
 */

/**
 * What the update check found, in words.
 *
 * `offline` says what failed rather than what is true. A check that never
 * reached the server has established nothing, and borrowing "up to date" for it
 * would send someone away from the one control that would have helped.
 */
const UPDATE_STATUS: Record<string, string> = {
  checking: 'Checking…',
  ready: 'A new version is ready.',
  current: 'This is the newest version.',
  offline: 'Could not reach the server. Nothing has changed on this device.',
}

const REASONS: Record<string, string> = {
  not_configured: 'This build has no sync server configured.',
  no_code: 'Enter or create a code first.',
  bad_code: 'That code is not valid — check for a typo.',
  network: 'Could not reach the server. Your progress is safe on this device.',
  stale_client: 'This app is out of date. Reload to update, then try again.',
}

export function SettingsRoute() {
  useDocumentTitle('Settings')
  const [code, setCode] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [rows, setRows] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const spoilers = useSpoilers()
  // Read once, synchronously: the choice was already applied to the document
  // by main.tsx, so this state only exists to light the right button.
  const [textChoice, setTextChoice] = useState<TextSize>(() => savedTextSize())
  const [, setTourDone] = useTourDone()
  const sw = useServiceWorker()
  const [meta, setMeta] = useState<Meta | null>(null)

  useEffect(() => {
    setCode(savedCode())
    setSyncedAt(lastSyncedAt())
    allProgress().then((all) => setRows(all.length))
    // Naming the version is half of what this section is for: "which build am
    // I actually running" is unanswerable from the outside, and it is the first
    // thing anyone reporting a stale app needs to be able to say.
    loadMeta()
      .then(setMeta)
      .catch(() => undefined)
  }, [])

  const configured = syncConfigured()

  const attach = (value: string): void => {
    const saved = saveCode(value)
    if (saved === null) {
      setResult({ ok: false, reason: 'bad_code' })
      return
    }
    setCode(saved)
    setDraft('')
    setResult(null)
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    const outcome = await syncNow()
    setResult(outcome)
    setSyncedAt(lastSyncedAt())
    setRows((await allProgress()).length)
    setBusy(false)
  }

  const forget = (): void => {
    saveCode(null)
    setCode(null)
    setResult(null)
    setSyncedAt(null)
  }

  // Two presses, because one press cannot be undone. There is no tombstone to
  // recover from and no server copy unless a code was set up, so a misplaced
  // tap on a phone is a museum tracker gone. The confirm state resets itself,
  // so it cannot sit armed and catch the next visit.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(timer)
  }, [armed])

  // The reinstall arms separately from the erase above — one confirm state for
  // two destructive buttons would let a tap meant for one arm the other.
  const [resetArmed, setResetArmed] = useState(false)
  useEffect(() => {
    if (!resetArmed) return
    const timer = setTimeout(() => setResetArmed(false), 5000)
    return () => clearTimeout(timer)
  }, [resetArmed])

  const reinstall = async (): Promise<void> => {
    if (!resetArmed) {
      setResetArmed(true)
      return
    }
    await sw.reinstall()
  }

  const clearProgress = async (): Promise<void> => {
    if (!armed) {
      setArmed(true)
      return
    }
    // Deletes rather than tombstones, deliberately: this is "forget everything
    // on this device", not "I have not done these". A tombstone would sync the
    // erasure to the other device, which is the opposite of what is meant.
    await db.progress.clear()
    setArmed(false)
    setRows(0)
  }

  return (
    <Column>
      <header>
        <h1 className="text-2xl">Settings</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Progress lives on this device. Nothing leaves it unless you set up a code.
        </p>
      </header>

      <Section title="This device">
        <p className="text-ink-mute text-sm">
          {rows === null ? (
            'Counting…'
          ) : (
            <>
              <span data-numeral>{rows}</span> {rows === 1 ? 'thing' : 'things'} recorded — museum
              donations and anything else you have ticked off.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={clearProgress}
          aria-live="polite"
          className="tap-target mt-2 rounded-tile border px-3 py-1.5 text-xs"
          style={
            armed
              ? { borderColor: 'var(--gap)', color: 'var(--gap)' }
              : { borderColor: 'var(--rule)', color: 'var(--ink-mute)' }
          }
        >
          {armed ? 'Tap again to erase everything' : 'Erase progress on this device'}
        </button>
      </Section>

      {/* The app updates itself when it notices a new version, and until now
          there was no way to make it notice. Two things it cannot see on its
          own: a redeploy that changed only the data (the worker script is
          byte-identical, so nothing prompts), and a device whose cached files
          are wrong in a way a new version does not correct. */}
      <Section title="Updates">
        <dl className="text-sm">
          <div className="flex justify-between gap-3 border-rule border-b py-1">
            <dt className="text-ink-mute">App</dt>
            <dd data-numeral className="text-ink">
              {__APP_VERSION__}
            </dd>
          </div>
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-mute">Data</dt>
            <dd className="min-w-0 truncate text-ink">
              {meta === null ? (
                '—'
              ) : (
                <>
                  <span data-numeral>{meta.dataVersion}</span>
                  {meta.builtAt !== null && (
                    <span className="text-ink-faint">
                      {' · '}
                      {new Date(meta.builtAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={sw.status === 'checking'}
            onClick={() => void (sw.status === 'ready' ? sw.applyUpdate() : sw.check())}
            className="tap-target rounded-tile border px-3 py-1.5 text-xs"
            style={
              sw.status === 'ready'
                ? {
                    borderColor: 'var(--rule)',
                    background: 'var(--accent-tint)',
                    color: 'var(--accent)',
                    fontWeight: 600,
                  }
                : { borderColor: 'var(--rule)', color: 'var(--ink-mute)' }
            }
          >
            {sw.status === 'ready' ? 'Reload to update' : 'Check for updates'}
          </button>
        </div>

        {sw.status !== 'idle' && (
          <p aria-live="polite" className="mt-2 text-ink-mute text-xs">
            {UPDATE_STATUS[sw.status]}
          </p>
        )}

        <p className="mt-4 text-ink-faint text-xs">
          Still showing something old? This throws away the copies of the app and its data held on
          this device and fetches them again.{' '}
          <strong className="font-normal text-ink-mute">
            Your progress is not stored with them and is not touched.
          </strong>{' '}
          It needs a connection.
        </p>
        <button
          type="button"
          disabled={!navigator.onLine}
          onClick={() => void reinstall()}
          aria-live="polite"
          className="tap-target mt-2 rounded-tile border px-3 py-1.5 text-xs disabled:opacity-50"
          style={
            resetArmed
              ? { borderColor: 'var(--gap)', color: 'var(--gap)' }
              : { borderColor: 'var(--rule)', color: 'var(--ink-mute)' }
          }
        >
          {!navigator.onLine
            ? 'Re-download the offline files — needs a connection'
            : resetArmed
              ? 'Tap again to re-download everything'
              : 'Re-download the offline files'}
        </button>
      </Section>

      <Section title="Text size">
        <p className="text-ink-mute text-sm">
          Makes everything in the app bigger. Applies to this device and takes effect immediately.
        </p>
        <fieldset className="mt-2 flex flex-wrap items-center gap-2">
          <legend className="sr-only">Text size</legend>
          {TEXT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => {
                setTextSize(size)
                setTextChoice(size)
              }}
              aria-pressed={textChoice === size}
              className="tap-target rounded-tile border px-3 py-1.5 text-xs transition-colors"
              style={
                textChoice === size
                  ? {
                      borderColor: 'var(--rule)',
                      background: 'var(--accent-tint)',
                      color: 'var(--accent)',
                      fontWeight: 600,
                    }
                  : { borderColor: 'var(--rule)', color: 'var(--ink-mute)' }
              }
            >
              {TEXT_SIZE_LABELS[size]}
            </button>
          ))}
        </fieldset>
      </Section>

      <Section title="The tour">
        <p className="text-ink-mute text-sm">
          The short walk around the app from your first visit. Replaying it starts right here.
        </p>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setTourDone(false)}
            className="tap-target rounded-tile border border-rule px-3 py-1.5 text-ink-mute text-xs hover:text-ink"
          >
            Show the tour again
          </button>
        </div>
      </Section>

      <Section title="Hidden things">
        <p className="text-ink-mute text-sm">
          Two kinds of thing start hidden: late-story spoilers — a certain villager, the last seals,
          the final quests — and content the wiki describes that isn’t in the game yet. Revealing
          one thing remembers just that one.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => spoilers.setShowAll(!spoilers.showAll)}
            aria-pressed={spoilers.showAll}
            className="tap-target rounded-tile border px-3 py-1.5 text-xs transition-colors"
            style={
              spoilers.showAll
                ? {
                    borderColor: 'var(--rule)',
                    background: 'var(--accent-tint)',
                    color: 'var(--accent)',
                    fontWeight: 600,
                  }
                : { borderColor: 'var(--rule)', color: 'var(--ink-mute)' }
            }
          >
            {spoilers.showAll ? 'Showing everything' : 'Show everything'}
          </button>
          <button
            type="button"
            onClick={spoilers.rehideAll}
            className="tap-target rounded-tile border border-rule px-3 py-1.5 text-ink-mute text-xs hover:text-ink"
          >
            Hide them all again
          </button>
        </div>
      </Section>

      <Section title="Sync to another device">
        {!configured ? (
          <p className="unverified rounded-tile px-2 py-1 text-xs">
            No sync server is configured in this build.
          </p>
        ) : code === null ? (
          <>
            <p className="text-ink-mute text-sm">
              Make a code here, then type it into your other device. Either order works — the two
              sets are merged, never overwritten.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => attach(newCode())}
                className="rounded-tile px-3 py-2 text-sm"
                style={{ background: 'var(--accent-tint)', color: 'var(--accent)' }}
              >
                Create a code
              </button>
              <label className="text-ink-mute text-xs" htmlFor="sync-code">
                or type one from another device
              </label>
              <div className="flex gap-2">
                <input
                  id="sync-code"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  // Four groups and a check character, which is what
                  // `generateCode` emits. The three-group placeholder that was
                  // here showed a shape the parser rejects — a hint that tells
                  // you your own valid code looks wrong.
                  placeholder="MSTR-0000-0000-0000-0000-0"
                  spellCheck={false}
                  autoCapitalize="characters"
                  className="min-w-0 flex-1 rounded-tile border border-rule bg-surface px-3 py-2 font-mono text-ink text-sm placeholder:text-ink-faint"
                />
                <button
                  type="button"
                  onClick={() => attach(draft)}
                  className="shrink-0 rounded-tile border border-rule px-3 py-2 text-ink text-sm"
                >
                  Use it
                </button>
              </div>
              {/*
                A rejected code has to say so *here*. The result line further
                down only renders once a code is attached, so a typo used to
                fail completely silently: press "Use it", nothing happens, and
                the only reading available is that the button is broken.
                `aria-live` because the message appears without the focus
                moving — a screen reader would otherwise never hear it.
              */}
              {result !== null && !result.ok && (
                <p aria-live="polite" className="unverified rounded-tile px-2 py-1 text-xs">
                  {REASONS[result.reason] ?? 'That did not work.'}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="select-all rounded-card border border-rule bg-sunk px-3 py-2 font-mono text-ink text-sm">
              {code}
            </p>
            {/*
              Next to the code, not in a footnote. With no accounts the code is
              the whole credential, and someone deciding where to write it down
              needs to know that while they are deciding.
            */}
            <p className="mt-2 text-ink-mute text-xs leading-relaxed">
              Anyone with this code can read and change this progress. There are no accounts, so the
              code is the only thing protecting it — treat it like a password.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="rounded-tile px-3 py-2 text-sm disabled:opacity-60"
                style={{ background: 'var(--accent-tint)', color: 'var(--accent)' }}
              >
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                type="button"
                onClick={forget}
                className="rounded-tile border border-rule px-3 py-2 text-ink-mute text-sm hover:text-ink"
              >
                Forget this code
              </button>
            </div>

            <p className="mt-2 text-ink-faint text-xs">
              {result === null
                ? syncedAt === null
                  ? 'Not synced yet.'
                  : `Last synced ${syncedAt.toLocaleString()}.`
                : result.ok
                  ? `Synced — ${result.merged} ${result.merged === 1 ? 'entry' : 'entries'}${
                      result.written ? '' : ', already up to date'
                    }.`
                  : (REASONS[result.reason] ?? 'Sync failed.')}
            </p>
          </>
        )}
      </Section>
    </Column>
  )
}
