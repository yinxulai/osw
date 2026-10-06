import { beforeEach, describe, expect, it } from 'vitest'
import { useRequestLogsUiStore } from './store'

/*
 * 请求记录页的界面状态。
 *
 * 只有 3 个字段，但 `setFilter` 一条就承担了两件事：**回到第一页**、**收起详情**。
 * 原因是留着展开的详情会和新筛选结果各说各话——详情里讲的是一条已经被筛掉的日志。
 */

const initialFilter = {
  providerId: 'all',
  providerModelId: 'all',
  logicalModelId: 'all',
  clientProtocol: 'all',
  status: 'all',
  createdTimeFrom: null,
  createdTimeTo: null,
}

beforeEach(() => {
  useRequestLogsUiStore.setState({ page: 1, expandedId: null, filter: initialFilter })
})

describe('初始状态', () => {
  it('第一页、没有展开、全部筛选都是 all', () => {
    const state = useRequestLogsUiStore.getState()
    expect(state.page).toBe(1)
    expect(state.expandedId).toBeNull()
    expect(state.filter).toEqual(initialFilter)
  })

  it('时间范围的默认值是 null，不是 0（0 会被当成 1970 年）', () => {
    const state = useRequestLogsUiStore.getState()
    expect(state.filter.createdTimeFrom).toBeNull()
    expect(state.filter.createdTimeTo).toBeNull()
  })
})

describe('setPage', () => {
  it('翻页', () => {
    useRequestLogsUiStore.getState().setPage(3)
    expect(useRequestLogsUiStore.getState().page).toBe(3)
  })

  it('翻页不收起已经展开的详情', () => {
    useRequestLogsUiStore.setState({ expandedId: 'log_1' })
    useRequestLogsUiStore.getState().setPage(2)
    expect(useRequestLogsUiStore.getState().expandedId).toBe('log_1')
  })
})

describe('setExpandedId', () => {
  it('展开与收起', () => {
    useRequestLogsUiStore.getState().setExpandedId('log_1')
    expect(useRequestLogsUiStore.getState().expandedId).toBe('log_1')

    useRequestLogsUiStore.getState().setExpandedId(null)
    expect(useRequestLogsUiStore.getState().expandedId).toBeNull()
  })
})

describe('setFilter', () => {
  it('是合并而不是替换：只改一项，其余保持不动', () => {
    useRequestLogsUiStore.getState().setFilter({ status: 'error' })

    expect(useRequestLogsUiStore.getState().filter).toEqual({ ...initialFilter, status: 'error' })
  })

  it('改筛选必须回到第一页（否则会停在一个被筛掉之后不存在的页码上）', () => {
    useRequestLogsUiStore.setState({ page: 5 })
    useRequestLogsUiStore.getState().setFilter({ providerId: 'p1' })

    expect(useRequestLogsUiStore.getState().page).toBe(1)
  })

  it('改筛选必须收起详情（详情里那条已经被新条件筛掉了）', () => {
    useRequestLogsUiStore.setState({ expandedId: 'log_1' })
    useRequestLogsUiStore.getState().setFilter({ status: 'error' })

    expect(useRequestLogsUiStore.getState().expandedId).toBeNull()
  })

  it('时间范围可以单独设，也可以单独清', () => {
    useRequestLogsUiStore.getState().setFilter({ createdTimeFrom: 1000, createdTimeTo: 2000 })
    expect(useRequestLogsUiStore.getState().filter.createdTimeFrom).toBe(1000)
    expect(useRequestLogsUiStore.getState().filter.createdTimeTo).toBe(2000)

    useRequestLogsUiStore.getState().setFilter({ createdTimeFrom: null, createdTimeTo: null })
    expect(useRequestLogsUiStore.getState().filter.createdTimeFrom).toBeNull()
    expect(useRequestLogsUiStore.getState().filter.createdTimeTo).toBeNull()
  })

  it('连续多次改筛选，每次都保留上一次的结果', () => {
    useRequestLogsUiStore.getState().setFilter({ providerId: 'p1' })
    useRequestLogsUiStore.getState().setFilter({ status: 'success' })
    useRequestLogsUiStore.getState().setFilter({ logicalModelId: 'm1' })

    expect(useRequestLogsUiStore.getState().filter).toEqual({
      ...initialFilter,
      providerId: 'p1',
      status: 'success',
      logicalModelId: 'm1',
    })
  })
})
