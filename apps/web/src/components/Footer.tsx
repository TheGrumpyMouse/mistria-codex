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

// From `@mistria/schema`, not declared here: the generated guide prints the
// same statement on every page and the pipeline cannot import from `apps/web`.
// Re-exported so `about.tsx` keeps importing it from the component that
// renders it, rather than every consumer having to learn where it moved.
import { ATTRIBUTION_TEXT, OFFICIAL_SITE, STEAM_PAGE, WIKI_SITE } from '@mistria/schema'

export { ATTRIBUTION_TEXT, OFFICIAL_SITE, STEAM_PAGE }

export function Footer() {
  return (
    <footer className="mt-10 border-rule border-t pt-4 pb-2 text-[0.6875rem] text-ink-faint leading-relaxed">
      <p className="max-w-prose">{ATTRIBUTION_TEXT}</p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <FooterLink href={OFFICIAL_SITE}>Official site</FooterLink>
        <FooterLink href={STEAM_PAGE}>Steam</FooterLink>
        <FooterLink href={WIKI_SITE}>Wiki</FooterLink>
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
