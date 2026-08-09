import { Link } from '@tanstack/react-router'
import { floorRange, type PlaceLabel, placeLabel } from '~/lib/labels'

/**
 * A place, linked, with its depth when it has one.
 *
 * **The range renders outside the anchor, and that is not a styling choice.**
 * The link's text is the place's *name* — it is what a screen reader announces
 * as the destination, and what the calendar folds into its search haystack
 * (`today.tsx`). Fold "floors 21–39" into the name and typing `39` starts
 * matching every ore in the Tide Caverns.
 *
 * One component rather than the same conditional at seven call sites, so the
 * wording cannot drift between the calendar, an item page and a monster's
 * home. The Mines screen already printed `floors 21–39` in its own column;
 * this matches it deliberately.
 */
export function PlaceLink({
  id,
  places,
  className,
}: {
  id: string
  places: Map<string, PlaceLabel>
  /** OpportunityCard passes the `.unverified` variant for inferred places. */
  className?: string
}) {
  const label = placeLabel(places, id)
  return (
    <>
      <Link to="/place/$id" params={{ id }} className={className}>
        {label.name}
      </Link>
      {label.floors !== null && (
        <span data-numeral className="text-ink-faint">
          {' '}
          ({floorRange(label.floors)})
        </span>
      )}
    </>
  )
}
