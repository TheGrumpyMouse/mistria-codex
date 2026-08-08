/**
 * How stale a wiki page is, relative to the game it describes.
 *
 * Fields of Mistria reached 1.0 on 2026-08-05 and the wiki is still catching up
 * page by page. A page last edited in February may describe a game that no
 * longer exists, and the honest response is to say so on the record rather than
 * to present a stale list with full confidence.
 *
 * Missing edit date counts as stale. That is the conservative direction: an
 * unnecessary "this may predate 1.0" badge costs a player nothing, whereas a
 * missing one costs them a wasted evening looking for something that moved.
 */

/** Fields of Mistria 1.0, per docs/research/01-game-data.md. */
export const GAME_1_0_RELEASED = '2026-08-05'

export const predates1_0 = (lastEdited: string | null): boolean =>
  lastEdited === null || lastEdited < GAME_1_0_RELEASED
