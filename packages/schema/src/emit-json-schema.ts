/**
 * Emit JSON Schema for every dataset into `build/schema/`.
 *
 * The Zod schemas are the single source of truth; these files are generated from
 * them. Hand-writing JSON Schema alongside Zod would create two contracts that
 * drift.
 *
 * The emitted files are not decoration — `pnpm validate` runs Ajv against them
 * as a second, independent pass. Zod validating against its own schema proves
 * nothing about the JSON Schema it produced, and Zod-to-JSON-Schema translation
 * drift is a real and silent failure mode.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DATASETS, type DatasetName } from './registry.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const OUT_DIR = join(REPO_ROOT, 'build', 'schema')

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  const written: string[] = []

  for (const name of Object.keys(DATASETS) as DatasetName[]) {
    const spec = DATASETS[name]
    const jsonSchema = z.toJSONSchema(z.array(spec.schema), { io: 'output' })

    const doc = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `https://mistria-codex/schema/${name}.json`,
      title: name,
      description: `${spec.description} Generated from packages/schema — do not edit.`,
      ...jsonSchema,
    }

    const out = join(OUT_DIR, `${name}.json`)
    await writeFile(out, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
    written.push(`${name}.json`)
  }

  console.log(`Emitted ${written.length} schemas to build/schema/`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
