import { LIST_SORT_LABELS, LIST_SORTS, type ListSort } from '~/lib/list-sort'

/**
 * How to order a findable list.
 *
 * Chips rather than a `<select>`, to match the filter rows they sit under on
 * the map — three options is fewer taps as buttons than as a menu, and the
 * chosen one stays readable without opening anything.
 *
 * `aria-pressed` rather than `role="radio"`: these are the same toggle chips
 * the season and weather filters use, and a screen reader announcing two
 * different widget types for two adjacent identical-looking rows is worse than
 * the slightly weaker semantics.
 *
 * A real `<fieldset>` names the group — the word "Sort" is drawn separately
 * and hidden from the accessibility tree, because a `<legend>` is laid out by
 * the browser rather than by the flex row and lands in the wrong place. The
 * label is said once either way.
 */
export function SortPicker({
  value,
  onChange,
  label = 'Sort',
}: {
  value: ListSort
  onChange: (sort: ListSort) => void
  label?: string
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1">
      <legend className="sr-only">{label}</legend>
      <span aria-hidden className="mr-0.5 text-ink-faint text-xs">
        {label}
      </span>
      {LIST_SORTS.map((sort) => (
        <button
          key={sort}
          type="button"
          aria-pressed={value === sort}
          onClick={() => onChange(sort)}
          className="tap-target rounded-pill border border-rule px-2.5 py-1 text-xs transition-colors"
          style={
            value === sort
              ? { background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }
              : { color: 'var(--ink-mute)' }
          }
        >
          {LIST_SORT_LABELS[sort]}
        </button>
      ))}
    </fieldset>
  )
}
