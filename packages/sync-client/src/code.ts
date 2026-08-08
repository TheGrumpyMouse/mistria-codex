/**
 * The device code: `MSTR-4K7Q-9XZ2-B3HF-P`.
 *
 * **Generated on the device, never by a server.** There is no `POST /codes`
 * endpoint, which saves a KV write, a round trip, and removes the obvious
 * write-amplification target from a free tier that allows 1,000 writes a day.
 *
 * Crockford Base32, because this is a string people read aloud and type on a
 * phone: it has no I, L, O or U, so it cannot spell anything unfortunate and
 * cannot be confused with 1 or 0. Decoding folds the ambiguous characters back,
 * so someone who types `O` for `0` or `l` for `1` is simply right.
 *
 * The trailing character is a mod-37 checksum. It is validated **before any
 * network call**, so a typo is instant and a malformed code never reaches KV.
 */

/** Crockford's alphabet: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** Crockford's check symbols extend the alphabet to 37 for the mod. */
const CHECK_ALPHABET = `${ALPHABET}*~$=U`

const GROUPS = 4
const GROUP_SIZE = 4

/** Fold the characters Crockford says are equivalent. */
function normaliseChar(char: string): string {
  const upper = char.toUpperCase()
  if (upper === 'O') return '0'
  if (upper === 'I' || upper === 'L') return '1'
  return upper
}

/** Strip formatting and fold ambiguous characters. `mstr-4k7q…` is fine. */
export function normaliseCode(input: string): string {
  return input
    .replace(/^\s*MSTR[-\s]*/i, '')
    .replace(/[-\s]/g, '')
    .split('')
    .map(normaliseChar)
    .join('')
}

/** The mod-37 check character for a payload. */
export function checksumOf(payload: string): string {
  let total = 0
  for (const char of payload) {
    const value = ALPHABET.indexOf(char)
    if (value === -1) throw new Error(`"${char}" is not a Crockford Base32 character`)
    total = (total * 32 + value) % 37
  }
  return CHECK_ALPHABET.charAt(total)
}

/** `MSTR-4K7Q-9XZ2-B3HF-P` from 16 payload characters plus a check. */
export function formatCode(payload: string, check: string): string {
  const groups: string[] = []
  for (let i = 0; i < payload.length; i += GROUP_SIZE) {
    groups.push(payload.slice(i, i + GROUP_SIZE))
  }
  return `MSTR-${groups.join('-')}-${check}`
}

/**
 * The one method this needs from `crypto`.
 *
 * Structural rather than `Crypto`, because **this package is imported by both
 * the browser app and the Cloudflare Worker** and those two type environments
 * do not agree on what `Crypto` is. Naming the method sidesteps the argument
 * and is honest about the dependency: one function, not an interface.
 */
export interface RandomSource {
  getRandomValues<T extends Uint8Array>(array: T): T
}

/**
 * A new code, from the platform's cryptographic random source.
 *
 * 80 bits. Not `Math.random`: this string is the only thing standing between a
 * stranger and someone's save progress, and a predictable one is no barrier at
 * all.
 */
export function generateCode(random: RandomSource = globalThis.crypto): string {
  const bytes = new Uint8Array(GROUPS * GROUP_SIZE)
  random.getRandomValues(bytes)

  const payload = [...bytes].map((byte) => ALPHABET.charAt(byte % 32)).join('')
  return formatCode(payload, checksumOf(payload))
}

export interface ParsedCode {
  /** The canonical form, for use as a KV key. */
  key: string
  /** How it should be shown back to the person who typed it. */
  formatted: string
}

/**
 * Validate and canonicalise a typed code.
 *
 * Null for anything that is not a well-formed code — wrong length, a character
 * outside the alphabet, or a failed checksum. The caller shows an error; nothing
 * touches the network.
 */
export function parseCode(input: string): ParsedCode | null {
  const normalised = normaliseCode(input)
  if (normalised.length !== GROUPS * GROUP_SIZE + 1) return null

  const payload = normalised.slice(0, -1)
  const check = normalised.slice(-1)
  if ([...payload].some((char) => !ALPHABET.includes(char))) return null

  let expected: string
  try {
    expected = checksumOf(payload)
  } catch {
    return null
  }
  if (expected !== check) return null

  return { key: payload, formatted: formatCode(payload, check) }
}
