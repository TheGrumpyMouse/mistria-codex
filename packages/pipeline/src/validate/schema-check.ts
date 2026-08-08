import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATASETS, type DatasetName } from '@mistria/schema'
import type { ValidateFunction } from 'ajv'
// ajv is CommonJS with ESM-style declarations, so TypeScript sees the module
// namespace rather than the export. The named import reads through correctly
// under Node's interop; a default import here resolves to the namespace object.
import { Ajv2020 } from 'ajv/dist/2020.js'
import { SCHEMA_DIR } from '../lib/paths.js'
import type { Loaded } from './load.js'
import { error, type Finding } from './report.js'

/** Pass 1: validate against the Zod schemas, which are the source of truth. */
export function checkZod(loaded: Loaded): Finding[] {
  const findings: Finding[] = []

  for (const name of Object.keys(DATASETS) as DatasetName[]) {
    const spec = DATASETS[name]
    const ds = loaded[name]

    ds.records.forEach((record, i) => {
      const result = spec.schema.safeParse(record)
      if (result.success) return
      for (const issue of result.error.issues.slice(0, 3)) {
        const at = issue.path.length > 0 ? issue.path.join('.') : '(root)'
        findings.push(error('schema:zod', `[${i}] ${at}: ${issue.message}`, `data/${spec.file}`))
      }
    })
  }

  return findings
}

/**
 * Pass 2: validate the same data against the *emitted* JSON Schema, with a
 * different implementation.
 *
 * Zod validating data against its own schema proves nothing about the JSON
 * Schema it generated. Translation drift between the two is a real and silent
 * failure mode — the emitted contract is what any external consumer would use,
 * so it has to be checked independently rather than assumed correct.
 */
export async function checkAjv(loaded: Loaded): Promise<Finding[]> {
  const findings: Finding[] = []
  // No emitted schema uses `format`, so format validation is off rather than
  // pulling in ajv-formats. If a format appears later this must be revisited —
  // with it off, `format` is silently ignored rather than enforced.
  const ajv = new Ajv2020({ allErrors: false, strict: false, validateFormats: false })

  for (const name of Object.keys(DATASETS) as DatasetName[]) {
    const spec = DATASETS[name]
    const ds = loaded[name]
    const schemaPath = join(SCHEMA_DIR, `${name}.json`)

    let validate: ValidateFunction
    try {
      const schema: unknown = JSON.parse(await readFile(schemaPath, 'utf8'))
      validate = ajv.compile(schema as object)
    } catch (err) {
      findings.push(
        error(
          'schema:ajv',
          `could not compile emitted schema (${(err as Error).message}). Run \`pnpm schema:emit\`.`,
          `build/schema/${name}.json`,
        ),
      )
      continue
    }

    if (validate(ds.records)) continue

    for (const e of (validate.errors ?? []).slice(0, 3)) {
      findings.push(
        error(
          'schema:ajv',
          `${e.instancePath || '(root)'} ${e.message ?? ''}`,
          `data/${spec.file}`,
        ),
      )
    }
  }

  return findings
}
