import { beforeEach, describe, expect, it } from 'vitest'
import { SettingsSchema, type Settings } from '@common/schemas'
import { useRuntimeSettingsUiStore } from './store'

/*
 * 设置页的草稿 / 基线。
 *
 * 「脏」这件事没有另存一份标记位，是**每次算出来的**：`draft` 与 `baseline` 序列化不等就是脏。
 * 这样「改回原样」会自己变回干净状态，不需要哪个调用方记得去清标记——下面是这条的核心用例。
 */

/**
 * 造一份完整的设置。
 *
 * 走真实 schema（`SettingsSchema.parse`）而不是手写 30 多个字段的字面量再断言：
 * 「必填的只有 `id` 与 `updatedTime`、其余全带默认值」这件事是 schema 说的，
 * 让 schema 自己补齐，用例就不必跟着每个字段的增删改。
 */
function settings(overrides: Partial<Settings> = {}): Settings {
  return SettingsSchema.parse({ id: 'singleton', updatedTime: 0, ...overrides })
}

beforeEach(() => {
  useRuntimeSettingsUiStore.setState({ draft: null, baseline: null, saved: false, isDirty: false })
})

describe('hydrate', () => {
  it('草稿与基线同时落成同一份数据，标记为干净', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings({ requestLogRetentionDays: 14 }))

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.draft).toEqual(state.baseline)
    expect(state.draft?.requestLogRetentionDays).toBe(14)
    expect(state.isDirty).toBe(false)
  })

  it('服务端重取回来时会盖掉本地草稿，同时清掉「已保存」标记', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings())
    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', 30)
    useRuntimeSettingsUiStore.getState().setSaved(true)

    useRuntimeSettingsUiStore.getState().hydrate(settings({ requestLogRetentionDays: 1 }))

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.draft?.requestLogRetentionDays).toBe(1)
    expect(state.baseline?.requestLogRetentionDays).toBe(1)
    expect(state.saved).toBe(false)
    expect(state.isDirty).toBe(false)
  })
})

describe('updateField', () => {
  it('改一个字段会把草稿改成新值，但不动基线', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings({ requestLogRetentionDays: 7 }))
    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', 30)

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.draft?.requestLogRetentionDays).toBe(30)
    expect(state.baseline?.requestLogRetentionDays).toBe(7)
    expect(state.isDirty).toBe(true)
  })

  it('改回原值就自己变回干净——不需要谁记得去清标记', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings({ requestLogRetentionDays: 7 }))
    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', 30)
    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(true)

    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', 7)

    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(false)
  })

  it('任何一次改动都会把「已保存」标记清掉', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings())
    useRuntimeSettingsUiStore.getState().setSaved(true)

    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', 30)

    expect(useRuntimeSettingsUiStore.getState().saved).toBe(false)
  })

  it('还没有基线时（草稿为空）任何写入都是空操作，不伪造出一份只有一半的数据', () => {
    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', 30)

    expect(useRuntimeSettingsUiStore.getState().draft).toBeNull()
    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(false)
  })

  it('写入是整值覆盖：键与值都直接进草稿，不跟旧值做逐字段合并', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings({ outboundProxyBypass: 'localhost' }))

    useRuntimeSettingsUiStore.getState().updateField('outboundProxyBypass', 'localhost,127.0.0.1:7890')

    expect(useRuntimeSettingsUiStore.getState().draft?.outboundProxyBypass).toBe('localhost,127.0.0.1:7890')
    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(true)
  })

  /*
   * 「脏」的判据是 `JSON.stringify` 的**字符串**比较，而 `JSON.stringify` 保留键的插入顺序。
   * 因此「值完全一样、只是键顺序不同」会被判成脏。
   *
   * 正常路径碰不到这种情况：基线直接来自服务端那一份，草稿是 `{ ...draft, [key]: value }`，
   * 已存在的键不会改变它在对象里的位置，所以两边的顺序始终一致。这里把这个边界写清楚，
   * 免得以后有人把 `hydrate` 改成「重新构造一份 settings」时，界面上开始出现莫名其妙
   * 「有未保存改动」而保存后什么都不变。
   */
  it('判脏是 JSON 字符串比较：键顺序不同就会被判成脏（正常路径下两边顺序一致）', () => {
    const baseline = settings()
    useRuntimeSettingsUiStore.getState().hydrate(baseline)

    // `{ ...rest, id }` 把 `id` 从最前面挪到最后：值与基线完全一样，只有键的插入顺序不同。
    const { id, ...rest } = baseline
    const reordered: Settings = { ...rest, id }
    useRuntimeSettingsUiStore.setState({ draft: reordered, baseline })

    useRuntimeSettingsUiStore.getState().updateField('contentRetentionDays', baseline.contentRetentionDays)

    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(true)
  })

  it('同一份对象顺序不变时，写回原值就是干净的', () => {
    const baseline = settings()
    useRuntimeSettingsUiStore.getState().hydrate(baseline)

    // 先改走再改回来：键顺序在这两步里都没变（已存在的键保持原位）。
    useRuntimeSettingsUiStore.getState().updateField('contentRetentionDays', 999)
    useRuntimeSettingsUiStore.getState().updateField('contentRetentionDays', baseline.contentRetentionDays)
    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', 30)
    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', baseline.requestLogRetentionDays)

    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(false)
  })
})

describe('resetDraft', () => {
  it('把草稿丢回基线并清掉脏标记', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings({ requestLogRetentionDays: 7 }))
    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', 30)

    useRuntimeSettingsUiStore.getState().resetDraft()

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.draft?.requestLogRetentionDays).toBe(7)
    expect(state.isDirty).toBe(false)
  })

  it('没有基线时原地不动（不会把草稿清成 null）', () => {
    expect(() => useRuntimeSettingsUiStore.getState().resetDraft()).not.toThrow()
    expect(useRuntimeSettingsUiStore.getState().draft).toBeNull()
  })
})

describe('setSaved', () => {
  it('只动这个标记，不碰草稿与脏状态', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings())
    useRuntimeSettingsUiStore.getState().updateField('requestLogRetentionDays', 30)

    useRuntimeSettingsUiStore.getState().setSaved(true)

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.saved).toBe(true)
    expect(state.draft?.requestLogRetentionDays).toBe(30)
    expect(state.isDirty).toBe(true)
  })
})
