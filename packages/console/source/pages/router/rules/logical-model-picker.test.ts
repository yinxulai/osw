import { describe, expect, it } from 'vitest'
import type { LogicalModel } from '@common/schemas'
import { filterModelsByKeyword, orderModelsBySelection } from './logical-model-picker'

const model = (modelId: string, description = ''): LogicalModel => ({ modelId, description } as LogicalModel)

describe('orderModelsBySelection', () => {
  it('puts selected models first in selection order, then the rest by id', () => {
    const models = [model('zeta'), model('alpha'), model('mid'), model('beta')]
    const ordered = orderModelsBySelection(models, ['mid', 'zeta'])
    expect(ordered.map(m => m.modelId)).toEqual(['mid', 'zeta', 'alpha', 'beta'])
  })

  it('does not mutate the input', () => {
    const models = [model('b'), model('a')]
    orderModelsBySelection(models, [])
    expect(models.map(m => m.modelId)).toEqual(['b', 'a'])
  })
})

describe('filterModelsByKeyword', () => {
  const models = [model('gpt-4o', 'fast'), model('claude', 'thoughtful'), model('local', 'offline fallback')]

  it('returns all models when the keyword is blank', () => {
    expect(filterModelsByKeyword(models, '   ')).toHaveLength(3)
  })

  it('matches id or description case-insensitively', () => {
    expect(filterModelsByKeyword(models, 'GPT').map(m => m.modelId)).toEqual(['gpt-4o'])
    expect(filterModelsByKeyword(models, 'fallback').map(m => m.modelId)).toEqual(['local'])
    expect(filterModelsByKeyword(models, 'zzz')).toHaveLength(0)
  })
})
