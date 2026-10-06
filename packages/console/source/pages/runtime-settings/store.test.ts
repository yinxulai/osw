import { beforeEach, describe, expect, it } from 'vitest'
import type { Settings } from '@common/schemas'
import { useRuntimeSettingsUiStore } from './store'

/*
 * 设置页的草稿 / 基线。
 *
 * 「脏」这件事没有另存一份标记位，是**每次算出来的**：`draft` 与 `baseline` 序列化不等就是脏。
 * 这样「改回原样」会自己变回干净状态，不需要哪个调用方记得去清标记——下面是这条的核心用例。
 */

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    logRetentionDays: 7,
    maxLogRows: 1000,
    outboundProxy: null,
    ...overrides,
  } as Settings
}

beforeEach(() => {
  useRuntimeSettingsUiStore.setState({ draft: null, baseline: null, saved: false, isDirty: false })
})

describe('hydrate', () => {
  it('草稿与基线同时落成同一份数据，标记为干净', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings({ logRetentionDays: 14 }))

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.draft).toEqual(state.baseline)
    expect(state.draft?.logRetentionDays).toBe(14)
    expect(state.isDirty).toBe(false)
  })

  it('服务端重取回来时会盖掉本地草稿，同时清掉「已保存」标记', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings())
    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', 30)
    useRuntimeSettingsUiStore.getState().setSaved(true)

    useRuntimeSettingsUiStore.getState().hydrate(settings({ logRetentionDays: 1 }))

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.draft?.logRetentionDays).toBe(1)
    expect(state.baseline?.logRetentionDays).toBe(1)
    expect(state.saved).toBe(false)
    expect(state.isDirty).toBe(false)
  })
})

describe('updateField', () => {
  it('改一个字段会把草稿改成新值，但不动基线', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings({ logRetentionDays: 7 }))
    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', 30)

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.draft?.logRetentionDays).toBe(30)
    expect(state.baseline?.logRetentionDays).toBe(7)
    expect(state.isDirty).toBe(true)
  })

  it('改回原值就自己变回干净——不需要谁记得去清标记', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings({ logRetentionDays: 7 }))
    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', 30)
    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(true)

    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', 7)

    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(false)
  })

  it('任何一次改动都会把「已保存」标记清掉', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings())
    useRuntimeSettingsUiStore.getState().setSaved(true)

    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', 30)

    expect(useRuntimeSettingsUiStore.getState().saved).toBe(false)
  })

  it('还没有基线时（草稿为空）任何写入都是空操作，不伪造出一份只有一半的数据', () => {
    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', 30)

    expect(useRuntimeSettingsUiStore.getState().draft).toBeNull()
    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(false)
  })

  it('改一个嵌套对象字段整体替换，不是深合并', () => {
    const proxy = { url: 'http://127.0.0.1:7890' } as Settings['outboundProxy']
    useRuntimeSettingsUiStore.getState().hydrate(settings({ outboundProxy: proxy }))

    useRuntimeSettingsUiStore.getState().updateField('outboundProxy', null)

    expect(useRuntimeSettingsUiStore.getState().draft?.outboundProxy).toBeNull()
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
    useRuntimeSettingsUiStore.getState().hydrate(settings())
    const baseline = useRuntimeSettingsUiStore.getState().draft as Settings

    const reordered = {
      maxLogRows: baseline.maxLogRows,
      logRetentionDays: baseline.logRetentionDays,
      outboundProxy: baseline.outboundProxy,
    } as Settings
    useRuntimeSettingsUiStore.setState({ draft: reordered, baseline })

    useRuntimeSettingsUiStore.getState().updateField('maxLogRows', baseline.maxLogRows)

    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(true)
  })

  it('同一份对象顺序不变时，写回原值就是干净的', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings())
    const baseline = useRuntimeSettingsUiStore.getState().draft as Settings

    // 先改走再改回来：键顺序在这两步里都没变（已存在的键保持原位）。
    useRuntimeSettingsUiStore.getState().updateField('maxLogRows', 999)
    useRuntimeSettingsUiStore.getState().updateField('maxLogRows', baseline.maxLogRows)
    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', 30)
    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', baseline.logRetentionDays)

    expect(useRuntimeSettingsUiStore.getState().isDirty).toBe(false)
  })
})

describe('resetDraft', () => {
  it('把草稿丢回基线并清掉脏标记', () => {
    useRuntimeSettingsUiStore.getState().hydrate(settings({ logRetentionDays: 7 }))
    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', 30)

    useRuntimeSettingsUiStore.getState().resetDraft()

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.draft?.logRetentionDays).toBe(7)
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
    useRuntimeSettingsUiStore.getState().updateField('logRetentionDays', 30)

    useRuntimeSettingsUiStore.getState().setSaved(true)

    const state = useRuntimeSettingsUiStore.getState()
    expect(state.saved).toBe(true)
    expect(state.draft?.logRetentionDays).toBe(30)
    expect(state.isDirty).toBe(true)
  })
})
