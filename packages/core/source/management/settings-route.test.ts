import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryEventInput } from '@common/telemetry'
import { closeDatabases, initDatabases } from '../database'
import { getSettings } from '@server/database/settings-store'
import { handleApiError } from './core/error-handler'
import { settingsRoutes } from './routes/operations/settings'
import { mockResponse } from './test-support'

/**
 * 切换生效模式是一次产品行为，这里是它唯一的写入口。要点是**只有真的换了才发**：
 * 界面保存任何一项设置都会把整个设置对象回写一遍，照「请求里带了这个字段」计数，
 * 数出来的是「保存过几次设置」。
 */
const { reported } = vi.hoisted(() => ({ reported: [] as TelemetryEventInput[] }))

vi.mock('@server/telemetry', () => ({
  reportTelemetryEvent: (event: TelemetryEventInput) => {
    reported.push(event)
  },
}))

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-settings-route-'))
  await initDatabases(temporaryDirectory)
  reported.length = 0
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function update(updates: Record<string, unknown>): Promise<void> {
  await settingsRoutes.invoke('/api/settings/update', mockResponse(), updates)
}

describe('settings read-back', () => {
  it('returns exactly what was written, so the form and the file agree', async () => {
    await update({ telemetryEnabled: false, listenPort: 9411 })

    const response = await settingsRoutes.request('/api/settings/get', {})

    expect(response.statusCode).toBe(200)
    expect(response.json<{ success: boolean; data: { telemetryEnabled: boolean; listenPort: number } }>().data).toMatchObject({
      telemetryEnabled: false,
      listenPort: 9411,
    })
  })

  it('rejects a custom proxy url that is not a url', async () => {
    // 空地址与非法协议都在 `validateOutboundProxyModeAndUrl` 里挡：写进库之后，
    // 下一次出站请求才会以「连不上」的形式暴露，那时离用户的操作已经很远了。
    await expect(settingsRoutes.request('/api/settings/update', { outboundProxyMode: 'custom', outboundProxyUrl: 'ftp://proxy.local' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('clears the stored url when the mode goes back to direct', async () => {
    await update({ outboundProxyMode: 'custom', outboundProxyUrl: 'http://127.0.0.1:7890' })

    await update({ outboundProxyMode: 'direct', outboundProxyUrl: '' })

    const settings = await getSettings()
    expect(settings.outboundProxyMode).toBe('direct')
    expect(settings.outboundProxyUrl).toBe('')
  })
})

describe('route_mode_changed reporting', () => {
  it('reports the new mode when it really changes', async () => {
    // 默认是 `workflow`，切到 `rules` 才算换过。
    await update({ routeMode: 'rules' })

    expect(reported).toEqual([{ name: 'route_mode_changed', mode: 'rules' }])
  })

  it('stays silent when the same mode is written back', async () => {
    await update({ routeMode: 'workflow' })

    expect(reported).toEqual([])
  })

  it('stays silent when another setting is saved', async () => {
    await update({ telemetryEnabled: false })

    expect(reported).toEqual([])
  })
})

describe('partial update', () => {
  /**
   * 补丁语义：**没提到的字段保持原值**。
   *
   * 这条用例挡的是一处不报错、也不留任何提示的回归：`SettingsSchema` 里近三十个字段都带
   * `.default()`，而 zod v4 的 `.partial()` 会在字段缺省时照旧套上默认值——于是界面保存
   * 一项设置会把其余全部回写成默认值：用户改一个端口，抓正文、遥测、云同步一起被重置。
   *
   * 只用两个字段说清这件事：`listenHost` 的默认值（`127.0.0.1`）与这里设的值不同，被改写时
   * 一眼可见，不必把近三十个字段逐个列出来。
   */
  it('leaves untouched fields alone', async () => {
    await update({ listenHost: '0.0.0.0', listenPort: 9411 })

    await update({ listenPort: 9412 })

    const settings = await getSettings()
    expect(settings.listenHost).toBe('0.0.0.0')
    expect(settings.listenPort).toBe(9412)
  })

  /**
   * `cloudSyncProvider` 是唯一一个 `default(...).catch(...)` 字段，剥默认值时必须把 `catch`
   * 一起剥掉。`catch` 的语义是「解析失败也给个兜底值」：对**整份读回**这是容错，对**补丁**
   * 就成了静默吞错——写进来一个不认识的后端名，保存看起来成功了，存下的却是默认后端，
   * 用户要到下次备份才发现自己选的不是它。所以这里要的是**报错**。
   *
   * 断言走 `handleApiError`：路由本身把 zod 的错误直接抛出去，翻译成 `VALIDATION_ERROR`
   * 是在管理端统一的错误出口做的，绕过它来断言会盯着一个界面永远看不到的形状。
   */
  it('rejects an unknown cloud sync provider instead of resetting it', async () => {
    const res = mockResponse()
    let thrown: unknown
    try {
      await settingsRoutes.invoke('/api/settings/update', res, { cloudSyncProvider: 'google-drive' })
      throw new Error('expected the update to be rejected')
    } catch (error) {
      thrown = error
    }

    handleApiError({ method: 'POST', url: '/api/settings/update' } as never, res, thrown)

    expect(res.statusCode).toBe(400)
  })
})
