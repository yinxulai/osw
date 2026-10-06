import { describe, expect, it } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import type { ClientConfigFillResultItem, ClientConfigFillStatus } from '@common/client-config'
import { describeFill, firstFillError } from './fill-summary'

const t = createAppTranslator('zh-CN')

function item(status: ClientConfigFillStatus, message = ''): ClientConfigFillResultItem {
  return { clientKey: `client-${status}-${message}`, status, filePaths: [], changeCount: 0, newVersions: 0, message }
}

describe('describeFill', () => {
  // 「已写入 2 个 · 3 个无需改动」与笼统一句「完成」的差别，就是用户能不能看出
  // 这一下到底动了几个客户端——本来就对的那些不该被算进「已生效」。
  it('逐状态计数，把它们拼成一读就分得开的句子', () => {
    expect(describeFill(t, [item('applied'), item('applied'), item('unchanged'), item('unchanged'), item('unchanged')]))
      .toBe('已写入 2 个 · 3 个无需改动')
  })

  it('只出现过的状态才出现在句子里', () => {
    expect(describeFill(t, [item('skipped')])).toBe('1 个跳过')
    expect(describeFill(t, [item('failed')])).toBe('1 个失败')
  })

  // 四个状态按「已写入 → 无需改动 → 跳过 → 失败」的固定顺序拼接，与传入顺序无关：
  // 结果数组的顺序是执行顺序，不该决定用户读到的句子。
  it('顺序固定，不受结果数组的排列影响', () => {
    expect(describeFill(t, [item('failed'), item('applied')])).toBe('已写入 1 个 · 1 个失败')
  })

  it('一条结果都没有时给出空串，由调用方决定说什么', () => {
    expect(describeFill(t, [])).toBe('')
  })
})

describe('firstFillError', () => {
  it('只报第一条失败原因', () => {
    const results = [item('applied'), item('failed', '第一个原因'), item('failed', '第二个原因')]
    expect(firstFillError(results)).toBe('第一个原因')
  })

  // 失败但没给原因（服务端没填 message）时返回 null，而不是空串：
  // 调用方靠它决定「这一行还要不要显示原因」，空串会渲染出一个空盒子。
  it('失败却没有原因时返回 null', () => {
    expect(firstFillError([item('failed')])).toBeNull()
  })

  it('全部成功时返回 null', () => {
    expect(firstFillError([item('applied'), item('unchanged')])).toBeNull()
  })
})
