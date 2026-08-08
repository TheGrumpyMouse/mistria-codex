/**
 * `pnpm validate` — everything that has to be true about the dataset.
 *
 * Errors fail the build. Warnings do not: coverage gaps and orphans are the
 * normal state of a project that ingests one category at a time, and a build
 * that fails on them is a build everyone learns to ignore.
 */
import { parseArgs } from 'node:util'
import { consola } from 'consola'
import {
  availabilityCoverage,
  computeCoverage,
  coverageFindings,
  writeCoverageReport,
} from './coverage.js'
import { checkGameAgreement } from './game-agreement.js'
import { checkGates } from './gates.js'
import { writeIdDivergenceReport } from './id-divergence.js'
import { checkLicensing } from './licensing.js'
import { loadAll } from './load.js'
import { checkMuseum } from './museum.js'
import { checkDuplicateKeys, checkOrphans, checkReferentialIntegrity } from './refint.js'
import { type Finding, summarise } from './report.js'
import { checkAjv, checkZod } from './schema-check.js'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      strict: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
  })

  const findings: Finding[] = []

  const { loaded, findings: loadFindings } = await loadAll()
  findings.push(...loadFindings)

  findings.push(...checkZod(loaded))
  findings.push(...(await checkAjv(loaded)))
  findings.push(...checkDuplicateKeys(loaded))
  findings.push(...checkReferentialIntegrity(loaded))
  findings.push(...checkOrphans(loaded))
  findings.push(...checkMuseum(loaded))
  findings.push(...checkGates(loaded))
  findings.push(...(await checkGameAgreement(loaded)))
  findings.push(...(await checkLicensing()))

  const coverage = computeCoverage(loaded)
  findings.push(...coverageFindings(coverage))
  await writeCoverageReport(coverage, availabilityCoverage(loaded))
  await writeIdDivergenceReport(loaded)

  const errors = findings.filter((f) => f.severity === 'error')
  const warnings = findings.filter((f) => f.severity === 'warning')

  if (warnings.length > 0 && !values.quiet) {
    consola.warn(`${warnings.length} warnings`)
    for (const line of summarise(warnings)) consola.log(`  ${line}`)
  }

  if (errors.length > 0) {
    consola.error(`${errors.length} errors`)
    for (const line of summarise(errors)) consola.log(`  ${line}`)
    process.exitCode = 1
    return
  }

  const ingested = coverage.filter((r) => r.have > 0).length
  consola.success(
    `Validation passed — ${ingested}/${coverage.length} datasets ingested, ` +
      `${warnings.length} warnings. See build/reports/coverage.md.`,
  )

  // `--strict` is for CI on the data branch: it refuses to let unresolved
  // tokens or coverage gaps sit unnoticed once a category is meant to be done.
  if (values.strict && warnings.length > 0) {
    consola.error('--strict: warnings are errors')
    process.exitCode = 1
  }
}

main().catch((err: unknown) => {
  consola.error(err)
  process.exitCode = 1
})
