import { readFile } from 'node:fs/promises'

/**
 * Read a JSON file, failing with the path in the message.
 *
 * Curated files carry `_comment` keys explaining their own rules, so comments
 * live in the data rather than in a parallel doc that goes stale. Those keys are
 * stripped here so consumers never see them.
 */
export async function readJsonFile<T>(path: string): Promise<T> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new Error(`could not read ${path}`)
  }

  try {
    return stripComments(JSON.parse(text)) as T
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`)
  }
}

function stripComments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripComments)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, child]) => [key, stripComments(child)]),
  )
}
