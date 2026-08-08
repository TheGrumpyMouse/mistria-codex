import { Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

/**
 * The way back, on every detail screen.
 *
 * Real history when there is any — an item reached from a villager's gift list
 * goes back to that villager, not to a generic index — and a sensible landing
 * when there is none, because a shared deep link opens with an empty history
 * and a back control that does nothing reads as broken.
 */
export function BackLink({
  fallback = '/search',
  params,
}: {
  fallback?: string
  /** Route params for a parameterised fallback, e.g. `/item/$id`. */
  params?: Record<string, string>
}) {
  const router = useRouter()

  if (router.history.canGoBack()) {
    return (
      <button
        type="button"
        onClick={() => router.history.back()}
        className="tap-target mb-2 inline-flex items-center gap-1 rounded-tile border border-rule px-3 py-1.5 text-ink-mute text-xs transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} />
        Back
      </button>
    )
  }

  return (
    <Link
      to={fallback}
      {...(params === undefined ? {} : { params })}
      className="tap-target mb-2 inline-flex items-center gap-1 rounded-tile border border-rule px-3 py-1.5 text-ink-mute text-xs transition-colors hover:text-ink"
    >
      <ArrowLeft size={14} strokeWidth={2} />
      Back
    </Link>
  )
}
