import { DATASET_NAMES, DATASETS, type DatasetName } from '@mistria/schema'
import { describe, expect, it } from 'vitest'
import { checkGates } from './gates.js'
import type { Loaded } from './load.js'

/** An empty dataset map, so a test only has to fill in what it cares about. */
function emptyLoaded(): Loaded {
  const loaded = {} as Loaded
  for (const name of DATASET_NAMES) {
    loaded[name] = { name, file: DATASETS[name].file, records: [], missing: true }
  }
  return loaded
}

function withRecords(entries: Partial<Record<DatasetName, unknown[]>>): Loaded {
  const loaded = emptyLoaded()
  for (const [name, records] of Object.entries(entries)) {
    loaded[name as DatasetName] = {
      name: name as DatasetName,
      file: DATASETS[name as DatasetName].file,
      records: records ?? [],
      missing: false,
    }
  }
  return loaded
}

const SKILLS = [{ id: 'fishing', perks: [{ id: 'steady_supplies' }] }]
const QUESTS = [{ id: 'upgrade_the_inn' }]

describe('gate targets', () => {
  it('passes when every gate names something real', () => {
    const loaded = withRecords({
      skills: SKILLS,
      quests: QUESTS,
      shops: [
        {
          id: 'inn',
          stock: [
            {
              item_id: 'coffee',
              requires: [
                { type: 'skill', key: 'fishing', op: '>=', value: 8 },
                { type: 'quest', key: 'upgrade_the_inn', op: 'done', value: null },
                { type: 'perk', key: 'steady_supplies', op: 'has', value: null },
              ],
            },
          ],
        },
      ],
    })
    expect(checkGates(loaded)).toEqual([])
  })

  it('catches a gate naming a quest that does not exist', () => {
    // The failure this exists for: `requires` is the only place the dataset
    // references another record by a bare string, so referential integrity
    // never sees it. A renamed quest silently becomes an unsatisfiable gate.
    const loaded = withRecords({
      skills: SKILLS,
      quests: QUESTS,
      mines: [
        {
          id: 'lava_caves',
          gate: [{ type: 'quest', key: 'breaking_the_fire_seal', op: 'done', value: null }],
        },
      ],
    })

    const findings = checkGates(loaded)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.check).toBe('gate:unknown-target')
    expect(findings[0]?.message).toContain('quest:breaking_the_fire_seal')
  })

  it('says nothing about gate types whose dataset has not landed', () => {
    // `building:mill` is not wrong, it is early. Warning about it would train
    // people to ignore the check.
    const loaded = withRecords({
      skills: SKILLS,
      quests: QUESTS,
      shops: [
        {
          id: 'inn',
          stock: [{ item_id: 'flour', requires: [{ type: 'building', key: 'mill', op: 'has' }] }],
        },
      ],
    })
    expect(checkGates(loaded)).toEqual([])
  })

  it('checks prerequisites and unlock_requires, not just requires', () => {
    const loaded = withRecords({
      skills: SKILLS,
      quests: QUESTS,
      museum_sets: [
        {
          id: 'fish_river',
          unlock_requires: [{ type: 'perk', key: 'not_a_perk', op: 'has', value: null }],
        },
      ],
    })
    expect(checkGates(loaded).map((f) => f.check)).toEqual(['gate:unknown-target'])
  })
})
