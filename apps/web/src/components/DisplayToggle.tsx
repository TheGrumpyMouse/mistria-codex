import { LayoutGrid, List } from 'lucide-react'
import { type DisplayMode, useDisplayMode } from '~/lib/display-mode'

/**
 * The icons/text switch, wherever a list can be drawn both ways.
 *
 * Two labelled radio-style buttons rather than one cycling button: a control
 * that shows only the current state makes the reader guess what pressing it
 * does.
 */
export function DisplayToggle() {
  const [mode, setMode] = useDisplayMode()

  const option = (value: DisplayMode, label: string, Icon: typeof List) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className="tap-target flex items-center gap-1 rounded-pill px-2 py-1 text-[0.6875rem] transition-colors"
      style={
        mode === value
          ? { background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }
          : { color: 'var(--ink-mute)' }
      }
    >
      <Icon size={12} strokeWidth={2} />
      {label}
    </button>
  )

  return (
    <span className="flex shrink-0 items-center rounded-pill border border-rule p-0.5">
      {option('icons', 'Icons', LayoutGrid)}
      {option('text', 'Text', List)}
    </span>
  )
}
