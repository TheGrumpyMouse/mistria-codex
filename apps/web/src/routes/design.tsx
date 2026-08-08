import { SEASONS, type Season } from '@mistria/schema'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'

/**
 * The design system, rendered.
 *
 * A tokens file is a claim; this page is the evidence. It exists so a change to
 * a token is visibly a change to the app, and so the pieces can be looked at
 * together rather than one at a time inside a feature.
 *
 * Not linked from the nav — it is for whoever is building, not for a player.
 */
export function DesignRoute() {
  return (
    <Column>
      <div className="flex flex-col gap-8">
        <header>
          <h1 className="text-2xl">Design system</h1>
          <p className="mt-1 max-w-prose text-ink-mute text-sm leading-relaxed">
            The Valley Almanac: a naturalist&rsquo;s field almanac crossed with a mosaic. The
            tessera is sharp; everything around it is soft. Documented in{' '}
            <code className="font-mono text-xs">docs/design-system.md</code>.
          </p>
        </header>

        <Block
          title="Ground and ink"
          note="The ink leans purple, which is what keeps the paper warm."
        >
          <div className="flex flex-wrap gap-2">
            {(['paper', 'surface', 'sunk', 'rule', 'ink-faint', 'ink-mute', 'ink'] as const).map(
              (token) => (
                <Swatch key={token} token={token} />
              ),
            )}
          </div>
        </Block>

        <Block
          title="Seasons"
          note="The accent is whichever season the app is showing. That is why no result needs a season badge."
        >
          <div className="flex flex-wrap gap-2">
            {SEASONS.flatMap((season: Season) => [
              <Swatch key={season} token={season} />,
              <Swatch key={`${season}-tint`} token={`${season}-tint`} />,
            ])}
          </div>
        </Block>

        <Block
          title="Signals"
          note="Outside the season system, so they never shift meaning. Unverified is never a colour."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Swatch token="museum" />
            <Swatch token="gap" />
            <Swatch token="locked" />
            <span className="unverified rounded-tile px-2 py-1 text-xs">time unknown</span>
          </div>
        </Block>

        <Block title="Type" note="Fraunces with WONK dialled up, Figtree, IBM Plex Mono.">
          <div className="flex flex-col gap-2">
            <p className="font-display text-3xl">Rainbow Trout</p>
            <p className="text-base">
              Found in rivers in spring and summer. Bites in any weather the season allows.
            </p>
            <p data-numeral className="text-base">
              120t &middot; 4:00 PM &middot; floors 21&ndash;39 &middot; MSTR-4K7Q-9XZ2
            </p>
          </div>
        </Block>

        <Block
          title="Item marks"
          note="The game's sprite where there is one, a drawn glyph where there is not — about thirty records have no art on the wiki, so the fallback is permanent, not legacy. The glyph hashes the icon key to a hue, stepped by the golden angle so a category page is not one colour."
        >
          <div className="flex flex-wrap items-center gap-2">
            {[
              'material/ore_copper',
              'crop/turnip',
              'forageable/acorn',
              'fish/rainbow_trout',
              'artifact/alda_clay_pot',
              'character/adeline',
              'monster/sapling',
            ].map((key) => (
              <ItemIcon key={key} iconKey={key} name={labelFor(key)} size="lg" />
            ))}
            {/* No sprite exists for either of these, so both take the glyph path
              — which is what the row is here to show. */}
            <ItemIcon iconKey="fish/unknown" name="No sprite" size="lg" />
            <ItemIcon iconKey="fish/unknown" name="Unverified" size="lg" unverified />
          </div>
        </Block>

        <Block title="Spacing" note="A strict 4px scale. Nothing in the app uses a value off it.">
          <div className="flex items-end gap-2">
            {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((step) => (
              <div key={step} className="flex flex-col items-center gap-1">
                <div
                  className="rounded-tile bg-accent-tint"
                  style={{ width: `var(--step-${step})`, height: `var(--step-${step})` }}
                />
                <span className="text-[10px] text-ink-faint" data-numeral>
                  {step}
                </span>
              </div>
            ))}
          </div>
        </Block>
      </div>
    </Column>
  )
}

function Block({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="text-lg">{title}</h2>
      <p className="mt-0.5 mb-3 max-w-prose text-ink-mute text-sm">{note}</p>
      {children}
    </section>
  )
}

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="size-12 rounded-tile border border-rule"
        style={{ background: `var(--${token})` }}
      />
      <span className="font-mono text-[10px] text-ink-faint">{token}</span>
    </div>
  )
}

const labelFor = (key: string): string =>
  (key.split('/')[1] ?? key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
