export type Severity = 'error' | 'warning'

export interface Finding {
  /** Which check produced this, so the output groups sensibly. */
  check: string
  severity: Severity
  message: string
  /** Repo-relative path, where the finding belongs to a file. */
  file?: string
}

export const error = (check: string, message: string, file?: string): Finding =>
  file === undefined
    ? { check, severity: 'error', message }
    : { check, severity: 'error', message, file }

export const warn = (check: string, message: string, file?: string): Finding =>
  file === undefined
    ? { check, severity: 'warning', message }
    : { check, severity: 'warning', message, file }

/**
 * Roll many findings of the same kind into one line.
 *
 * A broken alias table can produce thousands of identical failures; printing all
 * of them buries the other checks and makes the output useless. Show a few, then
 * a count.
 */
export function summarise(findings: Finding[], sampleSize = 5): string[] {
  const byCheck = new Map<string, Finding[]>()
  for (const f of findings) {
    const list = byCheck.get(f.check) ?? []
    list.push(f)
    byCheck.set(f.check, list)
  }

  const lines: string[] = []
  for (const [check, list] of byCheck) {
    lines.push(`${check}: ${list.length}`)
    for (const f of list.slice(0, sampleSize)) {
      lines.push(`  ${f.file ? `${f.file}: ` : ''}${f.message}`)
    }
    if (list.length > sampleSize) lines.push(`  ... and ${list.length - sampleSize} more`)
  }
  return lines
}
