/**
 * Print the curation to-do list.
 *
 * Every token the resolver could not place lands here rather than being guessed
 * at. An empty list means the alias tables cover the corpus; a long one is work,
 * not a failure.
 */
import { join } from 'node:path'
import { consola } from 'consola'
import { BUILD_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'

interface UnresolvedEntry {
  token: string
  field: string
  count: number
  owners: string[]
  suggestions: string[]
}

async function main(): Promise<void> {
  let entries: UnresolvedEntry[]
  try {
    entries = await readJsonFile<UnresolvedEntry[]>(join(BUILD_DIR, 'unresolved.json'))
  } catch {
    consola.info('No unresolved report yet — run `pnpm build:data` first.')
    return
  }

  if (entries.length === 0) {
    consola.success('No unresolved tokens. Every value in the corpus maps to the vocabulary.')
    return
  }

  consola.warn(`${entries.length} unresolved tokens`)
  for (const entry of entries) {
    const suggestion =
      entry.suggestions.length > 0 ? `  → did you mean: ${entry.suggestions.join(', ')}` : ''
    consola.log(
      `\n[${entry.field}] ${JSON.stringify(entry.token)}  (x${entry.count})` +
        `\n  seen on: ${entry.owners.join(', ')}${suggestion}`,
    )
  }
  consola.log('\nFix by adding an alias in curated/aliases/ or curated/vocab/.')
}

main().catch((err: unknown) => {
  consola.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
