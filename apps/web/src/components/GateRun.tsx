import { Link } from '@tanstack/react-router'
import type { DisplayIndex } from '~/lib/data'
import { gateDisplay } from '~/lib/labels'

/** A gate on a stock line, a shop, a building tier, or an availability window. */
export interface Gate {
  type: string
  key: string
  op?: string
  value?: unknown
}

/**
 * A run of gates, worded as things you do and linked where they have a page.
 *
 * Joined with "and" rather than a separator, because these are conjunctive:
 * every one has to be true before the line is stocked, and a "·" between them
 * reads as a choice.
 */
export function GateRun({ gates, index }: { gates: Gate[]; index: DisplayIndex }) {
  return (
    <>
      {gates.map((gate, i) => {
        const parts = gateDisplay(gate, index[gate.key]?.n)
        return (
          <span key={`${gate.type}:${gate.key}`}>
            {i > 0 && ' and '}
            {parts.prefix}
            {parts.linkTo === null ? (
              parts.label
            ) : (
              <Link
                to={parts.linkTo.to}
                params={{ id: parts.linkTo.id }}
                className="underline decoration-current underline-offset-2"
              >
                {parts.label}
              </Link>
            )}
            {parts.suffix}
          </span>
        )
      })}
    </>
  )
}
