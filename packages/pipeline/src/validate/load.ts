import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATASETS, type DatasetName } from '@mistria/schema'
import { DATA_DIR } from '../lib/paths.js'
import { error, type Finding } from './report.js'

export interface LoadedDataset {
  name: DatasetName
  file: string
  records: unknown[]
  /** True when the file is absent — expected before a category is ingested. */
  missing: boolean
}

export type Loaded = Record<DatasetName, LoadedDataset>

/**
 * Read every dataset from `data/`.
 *
 * A missing file is not an error: categories come online one at a time and the
 * coverage report is what surfaces the gap. A file that exists but isn't a JSON
 * array *is* an error — that shape is always a bug in the build.
 */
export async function loadAll(): Promise<{ loaded: Loaded; findings: Finding[] }> {
  const findings: Finding[] = []
  const loaded = {} as Loaded

  for (const name of Object.keys(DATASETS) as DatasetName[]) {
    const file = DATASETS[name].file
    const path = join(DATA_DIR, file)

    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      loaded[name] = { name, file, records: [], missing: true }
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      findings.push(error('parse', `not valid JSON: ${(err as Error).message}`, `data/${file}`))
      loaded[name] = { name, file, records: [], missing: false }
      continue
    }

    if (!Array.isArray(parsed)) {
      findings.push(error('parse', 'expected a JSON array of records', `data/${file}`))
      loaded[name] = { name, file, records: [], missing: false }
      continue
    }

    loaded[name] = { name, file, records: parsed, missing: false }
  }

  return { loaded, findings }
}
