/**
 * The attribution footer, on every route.
 *
 * The wording is fixed and is not ours to improve. It is the statement this
 * project operates under: the art belongs to NPC Studio, we do not claim it, and
 * saying so has to be permanent and visible rather than buried on a page nobody
 * opens. Attribution does not create a licence — see docs/DATA-POLICY.md — so
 * the least this can do is be honest and easy to find.
 *
 * Quiet by design. It sits below the content on every screen, in the smallest
 * type the palette allows, and never competes with the thing you came for.
 */

export const ATTRIBUTION_TEXT =
  'This is an unofficial fan-made companion app. All game assets, sprites, UI ' +
  'graphics, and character designs are the sole property of NPC Studio. We do ' +
  'not claim ownership of these assets. Full credit goes to the creators at NPC ' +
  'Studio.'

export const OFFICIAL_SITE = 'https://fieldsofmistria.com'
export const STEAM_PAGE = 'https://store.steampowered.com/app/2142790'

export function Footer() {
  return (
    <footer className="mt-10 border-rule border-t pt-4 pb-2 text-[11px] text-ink-faint leading-relaxed">
      <p className="max-w-prose">{ATTRIBUTION_TEXT}</p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <FooterLink href={OFFICIAL_SITE}>Official site</FooterLink>
        <FooterLink href={STEAM_PAGE}>Steam</FooterLink>
        <FooterLink href="https://fieldsofmistria.wiki.gg">Wiki</FooterLink>
      </p>
    </footer>
  )
}

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      // Opening in a new tab keeps an installed PWA from navigating away from
      // itself, which on iOS means losing the app until it is reopened.
      target="_blank"
      rel="noreferrer"
      className="underline decoration-rule underline-offset-4 hover:text-ink-mute"
    >
      {children}
    </a>
  )
}
