import { Column } from '~/app/AppShell'
import { ATTRIBUTION_TEXT, OFFICIAL_SITE, STEAM_PAGE } from '~/components/Footer'

/**
 * About, credits, and the honest statement of what this is.
 *
 * Every source gets named. This is a fan project built on other people's work
 * and someone else's game, and saying so plainly is both the licence condition
 * and the decent thing.
 *
 * The attribution wording is imported rather than retyped: it appears here and
 * in the footer, and two copies of a legal statement drift.
 */
export function AboutRoute() {
  return (
    <Column>
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-2xl">About</h1>
          <p className="mt-1 max-w-prose text-ink-mute text-sm leading-relaxed">
            Mistria Codex is an unofficial companion for Fields of Mistria. It works offline, keeps
            no account, and answers one question well: what can I go and find right now, and where.
          </p>
        </header>

        <Section title="Game assets and credit">
          <p className="rounded-card border border-rule bg-sunk p-3">{ATTRIBUTION_TEXT}</p>
          <p className="mt-3">
            Fields of Mistria is made by NPC Studio —{' '}
            <External href={OFFICIAL_SITE}>fieldsofmistria.com</External>, and on{' '}
            <External href={STEAM_PAGE}>Steam</External>. This app is free, non-commercial, and
            unaffiliated with them: no ads, no tracking, no payments, no account. Nothing you do
            here leaves your device unless you type in a sync code.
          </p>
          <p className="mt-3">
            The sprites are used under attribution, not under a licence. If the rights holder would
            like them removed,{' '}
            <External href="https://github.com/TheGrumpyMouse/mistria-codex/issues">
              open an issue
            </External>{' '}
            and they will be — they live in one directory precisely so that is a single deletion.
          </p>
          <p className="mt-3">
            In-game text is a separate matter and is not used at all. No item descriptions, no
            dialogue, no localisation strings, no wiki prose. Facts were read and then written again
            from scratch.
          </p>
        </Section>

        <Section title="Where the facts come from">
          <ul className="flex flex-col gap-2">
            <Credit
              name="Fields of Mistria Wiki"
              href="https://fieldsofmistria.wiki.gg"
              note="Prices, seasons, drop rates, floor ranges, schedules — verified there, then written in our own words and shapes. The wiki's text is CC BY-SA; the game's art, which it also hosts, is not."
            />
            <Credit
              name="AnnaNomoly, legacy-fields-of-mistria-mods"
              href="https://github.com/AnnaNomoly/legacy-fields-of-mistria-mods"
              note="The item identifier table, which is why an item here is called ore_copper and not copper_ore."
            />
            <Credit
              name="Fraunces, Figtree, IBM Plex Mono"
              href="https://github.com/google/fonts"
              note="SIL Open Font Licence. Self-hosted, never fetched from a CDN."
            />
            <Credit
              name="Lucide"
              href="https://lucide.dev"
              note="ISC. Every piece of interface iconography in the app."
            />
          </ul>
        </Section>

        <Section title="What it does not know">
          <p>
            When the dataset does not know something, the app says nothing rather than guessing — a
            missing time or place is simply left off. A deduction is drawn hollow and dashed, like{' '}
            <span className="unverified px-1">Sweetwater Farm</span>, and says underneath what it
            was deduced from — so a deduction never reads like a fact. A thing you cannot reach yet
            is shown and tagged, not hidden — you should be able to learn that the Legendary fish
            exists and why you cannot catch it.
          </p>
        </Section>

        <p className="text-ink-faint text-xs">
          Version <span data-numeral>{__APP_VERSION__}</span> · MIT licensed ·{' '}
          <a
            href="https://github.com/TheGrumpyMouse/mistria-codex"
            className="underline decoration-rule underline-offset-4"
          >
            source
          </a>
        </p>
      </div>
    </Column>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg">{title}</h2>
      <div className="mt-2 max-w-prose text-ink-mute text-sm leading-relaxed">{children}</div>
    </section>
  )
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-ink underline decoration-rule underline-offset-4 hover:decoration-current"
    >
      {children}
    </a>
  )
}

function Credit({ name, href, note }: { name: string; href: string; note: string }) {
  return (
    <li>
      <a
        href={href}
        className="font-medium text-ink underline decoration-rule underline-offset-4 hover:decoration-current"
      >
        {name}
      </a>
      <span className="text-ink-mute"> — {note}</span>
    </li>
  )
}
