import { describe, expect, it } from 'vitest'
import type { LogicalModel } from '@common/schemas'
import { buildModelCatalog, type CodexModelTemplate } from './model-catalog-endpoint'

const TEMPLATE: CodexModelTemplate = {
  slug: 'gpt-6-astra',
  display_name: 'GPT-6-Astra',
  description: 'Our most capable model for complex, demanding work.',
  visibility: 'list',
  priority: 1,
  additional_speed_tiers: ['fast'],
  service_tiers: [{ id: 'priority', name: 'Fast', description: '2x speed, increased usage' }],
  default_service_tier: 'priority',
  upgrade: { model: 'gpt-7', migration_markdown: '' },
  availability_nux: { message: 'hello' },
  supported_reasoning_levels: [{ effort: 'high', description: 'Greater reasoning depth' }],
  base_instructions: 'You are Codex, a coding agent.',
  model_messages: { instructions_template: 'You are Codex, a coding agent.' },
}

function logicalModel(modelId: string, description = ''): LogicalModel {
  return {
    id: `lm_${modelId}`,
    modelId,
    description,
    enabled: true,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  }
}

describe('buildModelCatalog', () => {
  it('把每个逻辑模型写成一条 Codex 目录项，名字就是请求里的模型名', () => {
    const catalog = buildModelCatalog([logicalModel('default', '兜底'), logicalModel('fast-model')], TEMPLATE)

    expect(catalog.models.map(model => model.slug)).toEqual(['default', 'fast-model'])
    expect(catalog.models.map(model => model.display_name)).toEqual(['default', 'fast-model'])
    expect(catalog.models.map(model => model.description)).toEqual(['兜底', null])
  })

  it('保留 Codex 自带的提示词与元数据——缺了整份目录解析失败', () => {
    const [model] = buildModelCatalog([logicalModel('default')], TEMPLATE).models

    expect(model.base_instructions).toBe(TEMPLATE.base_instructions)
    expect(model.model_messages).toEqual(TEMPLATE.model_messages)
    expect(model.supported_reasoning_levels).toEqual(TEMPLATE.supported_reasoning_levels)
    expect(model.visibility).toBe('list')
  })

  it('不把 OpenAI 自家的速度档位与升级路线挂到 osw 的模型上', () => {
    const [model] = buildModelCatalog([logicalModel('default')], TEMPLATE).models

    expect(model.additional_speed_tiers).toEqual([])
    expect(model.service_tiers).toEqual([])
    expect(model.default_service_tier).toBeNull()
    expect(model.upgrade).toBeNull()
    expect(model.availability_nux).toBeNull()
  })

  it('priority 从大到小排，靠前的逻辑模型排在前面', () => {
    const catalog = buildModelCatalog([logicalModel('first'), logicalModel('second'), logicalModel('third')], TEMPLATE)

    expect(catalog.models.map(model => model.priority)).toEqual([3, 2, 1])
  })

  it('模型清单为空时给出一份空目录，而不是编造一条', () => {
    expect(buildModelCatalog([], TEMPLATE)).toEqual({ models: [] })
  })
})
