/**
 * The two wrappers every detail screen is made of.
 *
 * Extracted from the item route when the villager route needed the same pair.
 * `Unknown` matters more than it looks: it is the single place the "we don't
 * know this" treatment is defined, so a missing value can never accidentally
 * render like a known one.
 */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="font-display font-semibold text-ink text-sm">{title}</h2>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

export const Unknown = ({ children }: { children: React.ReactNode }) => (
  <p className="unverified inline-block rounded-tile px-2 py-1 text-xs">{children}</p>
)
