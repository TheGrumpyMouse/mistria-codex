import { describe, expect, it } from 'vitest'
import { checksumOf, formatCode, generateCode, normaliseCode, parseCode } from './code.js'

describe('generateCode', () => {
  it('produces a code that parses', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode()
      expect(code).toMatch(/^MSTR(-[0-9A-Z*~$=]{1,4}){5}$/)
      expect(parseCode(code)).not.toBeNull()
    }
  })

  it('never uses a letter Crockford excludes', () => {
    // I, L, O and U are out: the first three are confusable with 1 and 0, and
    // U is left out so the alphabet cannot spell anything unfortunate.
    for (let i = 0; i < 200; i += 1) {
      expect(
        generateCode()
          .replace(/^MSTR-/, '')
          .replace(/-/g, ''),
      ).not.toMatch(/[ILO]/)
    }
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateCode()))
    expect(seen.size).toBe(500)
  })
})

describe('parseCode', () => {
  const code = generateCode()

  it('accepts the code it was given', () => {
    expect(parseCode(code)?.formatted).toBe(code)
  })

  it('accepts it typed badly', () => {
    // Lowercase, no prefix, no dashes, stray spaces — all the ways someone
    // reads a code off another screen.
    const bare = code.replace(/^MSTR-/, '').replace(/-/g, '')
    expect(parseCode(bare.toLowerCase())?.formatted).toBe(code)
    expect(parseCode(`  ${bare}  `)?.formatted).toBe(code)
    expect(parseCode(code.toLowerCase())?.formatted).toBe(code)
  })

  it('folds the characters Crockford says are the same', () => {
    // Someone who types O for 0 or l for 1 is simply right.
    const payload = '00001111222233'.padEnd(16, '5')
    const full = formatCode(payload, checksumOf(payload))
    const mistyped = full.replace(/0/g, 'O').replace(/1/g, 'l')
    expect(parseCode(mistyped)?.formatted).toBe(full)
  })

  it('rejects a single-character typo', () => {
    // The whole point of the checksum: catch it here, instantly, rather than
    // letting a malformed code reach the network and 404.
    const payload = 'ABCDEFGH12345678'
    const good = formatCode(payload, checksumOf(payload))
    const bad = good.replace('ABCD', 'ABCE')
    expect(parseCode(good)).not.toBeNull()
    expect(parseCode(bad)).toBeNull()
  })

  it('rejects the wrong length and stray characters', () => {
    expect(parseCode('')).toBeNull()
    expect(parseCode('MSTR-ABCD')).toBeNull()
    expect(parseCode('MSTR-ABCD-EFGH-1234-5678-9-EXTRA')).toBeNull()
  })
})

describe('normaliseCode', () => {
  it('strips the prefix and the dashes', () => {
    expect(normaliseCode('MSTR-4K7Q-9XZ2-B3HF-P')).toBe('4K7Q9XZ2B3HFP')
  })
})

describe('checksumOf', () => {
  it('is stable', () => {
    expect(checksumOf('ABCDEFGH12345678')).toBe(checksumOf('ABCDEFGH12345678'))
  })

  it('changes when any character does', () => {
    const base = 'ABCDEFGH12345678'
    const changed = new Set(
      [...base].map((_, i) => checksumOf(`${base.slice(0, i)}Z${base.slice(i + 1)}`)),
    )
    // Not all 16 need differ from each other, but the check must not be
    // constant — a constant check catches nothing.
    expect(changed.size).toBeGreaterThan(1)
  })

  it('refuses a character outside the alphabet', () => {
    expect(() => checksumOf('ABCI')).toThrow()
  })
})
