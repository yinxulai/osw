// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clientConfigApi } from './client-config'
import { cloudSyncApi } from './cloud-sync'
import { unwrap } from './unwrap'
import { ApiRequestError } from './errors'
import { logicalModelApi, providerModelApi, requestRewriteRuleApi, schedulingPolicyApi } from './models'
import { analyticsApi, logsApi, requestLogApi, storageApi } from './observability'
import { providerApi, providerTransferApi } from './providers'
import { routerRulesApi } from './router-rules'
import { routerApi } from './router'
import { healthApi, logicalModelRoutingApi, outboundProxyApi, proxyApi, settingsApi, telemetryApi } from './runtime'
import { developmentApi, modelTestApi } from './tools'

/**
 * 管理接口的**路径与请求体契约**。
 *
 * 这些包装函数本身没有逻辑，但它们的字面量是前后端之间的唯一约定：路径拼错、参数名写错
 * （`providerId` 写成 `provider_id`）在编译期完全看不出来，只会在运行时报 404 或「缺少参数」。
 * 所以这里逐个把这些字面量钉住，而不是只断言「调用了一次 fetch」。
 */

interface CapturedCall {
  path: string
  body: Record<string, unknown>
}

function captureBody(): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))
}

function capturedPath(): string {
  const url = String(vi.mocked(fetch).mock.calls.at(-1)![0])
  // 基地址随运行形态变化，这里只关心它之后的那一段。
  return url.slice(url.indexOf('/api') + '/api'.length)
}

function lastCall(): CapturedCall {
  return { path: capturedPath(), body: captureBody() }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true, data: null }), { status: 200, headers: { 'content-type': 'application/json' } })),
  ))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('供应商接口', () => {
  it('list / listIncludingDeleted 共用同一路径，靠 includeDeleted 区分', async () => {
    await providerApi.list()
    expect(lastCall()).toEqual({ path: '/provider/list', body: {} })

    await providerApi.listIncludingDeleted()
    expect(lastCall()).toEqual({ path: '/provider/list', body: { includeDeleted: true } })
  })

  it('get / endpoints 都按 id 寻址', async () => {
    await providerApi.get('prov_1')
    expect(lastCall()).toEqual({ path: '/provider/get', body: { id: 'prov_1' } })

    await providerApi.endpoints('prov_1')
    expect(lastCall()).toEqual({ path: '/provider/endpoints', body: { id: 'prov_1' } })
  })

  it('fetchModels 原样带上探测所需的协议与凭据', async () => {
    await providerApi.fetchModels({ protocol: 'openai-responses', providerId: 'prov_1', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x' })

    expect(lastCall()).toEqual({
      path: '/provider/fetch-models',
      body: { protocol: 'openai-responses', providerId: 'prov_1', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x' },
    })
  })

  it('update 把 id 摊平进请求体，与其它字段同级', async () => {
    await providerApi.update('prov_1', { name: 'Renamed', enabled: false })

    expect(lastCall()).toEqual({ path: '/provider/update', body: { id: 'prov_1', name: 'Renamed', enabled: false } })
  })

  it('reorder 传整个 id 数组而不是逐个调用', async () => {
    await providerApi.reorder(['prov_2', 'prov_1'])

    expect(lastCall()).toEqual({ path: '/provider/reorder', body: { ids: ['prov_2', 'prov_1'] } })
  })

  it('remove / resetHealth 走各自的路径', async () => {
    await providerApi.remove('prov_1')
    expect(lastCall()).toEqual({ path: '/provider/delete', body: { id: 'prov_1' } })

    await providerApi.resetHealth('prov_1')
    expect(lastCall()).toEqual({ path: '/provider/reset-health', body: { providerId: 'prov_1' } })
  })

  it('导入导出：导出带选项，导入把整个包原样塞进 bundle 字段', async () => {
    await providerTransferApi.export({ providerIds: ['prov_1'], includeApiKey: true })
    expect(lastCall()).toEqual({ path: '/provider/export', body: { providerIds: ['prov_1'], includeApiKey: true } })

    await providerTransferApi.import({ version: 1, providers: [] })
    expect(lastCall()).toEqual({ path: '/provider/import', body: { bundle: { version: 1, providers: [] } } })
  })
})

describe('模型接口', () => {
  it('逻辑模型按数据记录 id 寻址，模型名只在 create 时用', async () => {
    await logicalModelApi.get('lm_1')
    expect(lastCall()).toEqual({ path: '/logical-model/get', body: { id: 'lm_1' } })

    await logicalModelApi.create({ modelId: 'gpt-4o', description: 'd', enabled: true })
    expect(lastCall()).toEqual({ path: '/logical-model/create', body: { modelId: 'gpt-4o', description: 'd', enabled: true } })

    await logicalModelApi.update('lm_1', { modelId: 'gpt-4o-mini' })
    expect(lastCall()).toEqual({ path: '/logical-model/update', body: { id: 'lm_1', modelId: 'gpt-4o-mini' } })
  })

  it('供应商模型列表有「含软删除」的入口', async () => {
    await providerModelApi.listIncludingDeleted()

    expect(lastCall()).toEqual({ path: '/provider-model/list', body: { includeDeleted: true } })
  })

  it('调度绑定按 logicalModelId 过滤，不是按模型名', async () => {
    await providerModelApi.listByLogicalModel('lm_1')

    expect(lastCall()).toEqual({ path: '/provider-model/list-by-logical-model', body: { logicalModelId: 'lm_1' } })
  })

  it('规则绑定读写在 /request-rewrite-rule 下的两个不同路径', async () => {
    await providerModelApi.requestRewriteRules('pm_1')
    expect(lastCall()).toEqual({ path: '/request-rewrite-rule/bindings', body: { providerModelId: 'pm_1' } })

    await providerModelApi.replaceRequestRewriteRules('pm_1', [{ ruleId: 'rule_1', priority: 1, enabled: true }])
    expect(lastCall()).toEqual({
      path: '/request-rewrite-rule/replace-bindings',
      body: { providerModelId: 'pm_1', bindings: [{ ruleId: 'rule_1', priority: 1, enabled: true }] },
    })
  })

  it('调度策略不传 logicalModelId 时发出空对象，而不是 undefined 字段', async () => {
    await schedulingPolicyApi.list()
    expect(lastCall()).toEqual({ path: '/scheduling-policy/list', body: {} })

    await schedulingPolicyApi.list('lm_1')
    expect(lastCall()).toEqual({ path: '/scheduling-policy/list', body: { logicalModelId: 'lm_1' } })
  })

  it('调度策略删除要同时说清是哪一对绑定', async () => {
    await schedulingPolicyApi.remove('lm_1', 'pm_1')

    expect(lastCall()).toEqual({ path: '/scheduling-policy/delete', body: { logicalModelId: 'lm_1', providerModelId: 'pm_1' } })
  })

  it('改写规则试跑把规则与用例一起交给服务端', async () => {
    const rule = { id: 'rule_1', name: 'r' } as never
    const testCase = { name: 'case', body: '{}' } as never

    await requestRewriteRuleApi.test(rule, testCase)

    expect(lastCall()).toEqual({ path: '/request-rewrite-rule/test', body: { rule, testCase } })
  })

  it('改写规则删除会回报受影响的绑定数量', async () => {
    await requestRewriteRuleApi.remove('rule_1')

    expect(lastCall()).toEqual({ path: '/request-rewrite-rule/delete', body: { id: 'rule_1' } })
  })
})

describe('路由图与路由规则接口', () => {
  it('路由图与路由规则是两个互不相干的命名空间', async () => {
    await routerApi.getGraph()
    expect(capturedPath()).toBe('/router/graph')

    await routerRulesApi.getRules()
    expect(capturedPath()).toBe('/router/rules')
  })

  it('读指定版本时版本号放在 id 字段里', async () => {
    await routerApi.getGraphVersion('ver_1')
    expect(lastCall()).toEqual({ path: '/router/graph/version', body: { id: 'ver_1' } })

    await routerRulesApi.getRuleVersion('ver_1')
    expect(lastCall()).toEqual({ path: '/router/rules/version', body: { id: 'ver_1' } })
  })

  it('试跑把图 / 规则表与输入一起送给服务端，并透传中断信号', async () => {
    const graph = { nodes: [], edges: [] } as never
    const controller = new AbortController()

    await routerApi.run(graph, { model: 'gpt-4o' }, controller.signal)

    expect(lastCall()).toEqual({ path: '/router/run', body: { graph, inputPayload: { model: 'gpt-4o' } } })
    expect(vi.mocked(fetch).mock.calls.at(-1)![1]!.signal).toBe(controller.signal)

    await routerRulesApi.run({ rules: [] } as never, { model: 'gpt-4o' }, controller.signal)
    expect(lastCall()).toEqual({ path: '/router/rules/run', body: { ruleSet: { rules: [] }, inputPayload: { model: 'gpt-4o' } } })
  })

  it('保存为新版本时把名称与说明一起带上', async () => {
    await routerRulesApi.saveRules({ rules: [] } as never, '新策略', '说明')

    expect(lastCall()).toEqual({ path: '/router/rules/save', body: { ruleSet: { rules: [] }, name: '新策略', description: '说明' } })
  })
})

describe('观测接口', () => {
  it('请求日志的过滤条件原样下发，不传时是空对象', async () => {
    await requestLogApi.list()
    expect(lastCall()).toEqual({ path: '/request-log/list', body: {} })

    await requestLogApi.list({ limit: 20, offset: 40, status: 'failed', protocol: 'anthropic-messages', createdTimeFrom: 1, createdTimeTo: 2 })
    expect(lastCall()).toEqual({
      path: '/request-log/list',
      body: { limit: 20, offset: 40, status: 'failed', protocol: 'anthropic-messages', createdTimeFrom: 1, createdTimeTo: 2 },
    })
  })

  it('请求详情与正文是两个请求：正文可能很大，列表页不必拉', async () => {
    await requestLogApi.detail('req_1')
    expect(lastCall()).toEqual({ path: '/request-log/detail', body: { id: 'req_1' } })

    await requestLogApi.bodies('req_1')
    expect(lastCall()).toEqual({ path: '/request-log/bodies', body: { id: 'req_1' } })
  })

  it('清理日志同时给出两类保留期', async () => {
    await requestLogApi.prune({ requestLogRetentionDays: 7, contentRetentionDays: 3 })

    expect(lastCall()).toEqual({ path: '/request-log/prune', body: { requestLogRetentionDays: 7, contentRetentionDays: 3 } })
  })

  it('分析接口默认 7 天', async () => {
    await analyticsApi.summary()
    expect(lastCall()).toEqual({ path: '/analytics/summary', body: { range: '7d' } })

    await analyticsApi.providerDetail('prov_1', '30d')
    expect(lastCall()).toEqual({ path: '/analytics/provider-detail', body: { providerId: 'prov_1', range: '30d' } })
  })

  it('日志与磁盘占用走各自的路径', async () => {
    await logsApi.list({ level: 'error', query: 'timeout' })
    expect(lastCall()).toEqual({ path: '/logs/list', body: { level: 'error', query: 'timeout' } })

    await storageApi.usage()
    expect(lastCall()).toEqual({ path: '/storage/usage', body: {} })
  })
})

describe('运行时与设置接口', () => {
  it('设置读取与更新', async () => {
    await settingsApi.get()
    expect(lastCall()).toEqual({ path: '/settings/get', body: {} })

    await settingsApi.update({ language: 'zh-CN' })
    expect(lastCall()).toEqual({ path: '/settings/update', body: { language: 'zh-CN' } })
  })

  // 上报失败不该让触发它的那次操作表现成失败，所以这个包装连返回值都不给。
  it('遥测上报不发回 Promise 结果', async () => {
    expect(telemetryApi.report({ name: 'app.opened' } as never)).toBeUndefined()
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())

    expect(lastCall()).toEqual({ path: '/telemetry/report', body: { name: 'app.opened' } })
  })

  it('代理开关四个动作各自一条路径', async () => {
    await proxyApi.status()
    expect(capturedPath()).toBe('/proxy/status')

    await proxyApi.start()
    expect(capturedPath()).toBe('/proxy/start')

    await proxyApi.stop()
    expect(capturedPath()).toBe('/proxy/stop')

    await proxyApi.restart()
    expect(capturedPath()).toBe('/proxy/restart')
  })

  it('逻辑模型手动切换把 null 当成有效取值下发（取消手动）', async () => {
    await logicalModelRoutingApi.switch('lm_1', null)

    expect(lastCall()).toEqual({ path: '/logical-model/switch', body: { logicalModelId: 'lm_1', modelId: null } })
  })

  it('出站代理试连带上完整四元组', async () => {
    await outboundProxyApi.test({ mode: 'manual', proxyUrl: 'http://127.0.0.1:7890', bypass: 'localhost', targetUrl: 'https://api.example.com' })

    expect(lastCall()).toEqual({
      path: '/outbound-proxy/test',
      body: { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890', bypass: 'localhost', targetUrl: 'https://api.example.com' },
    })
  })

  it('健康快照与开发种子数据', async () => {
    await healthApi.list()
    expect(capturedPath()).toBe('/health/list')

    await developmentApi.seed()
    expect(capturedPath()).toBe('/development/seed')
  })

  it('模型测试把协议、模式与筛选条件一起下发', async () => {
    await modelTestApi.run('openai-responses', 'chat', { providerIds: ['prov_1'], modelIds: ['pm_1'] })

    expect(lastCall()).toEqual({
      path: '/model-test/run',
      body: { protocol: 'openai-responses', mode: 'chat', providerIds: ['prov_1'], modelIds: ['pm_1'] },
    })
  })
})

describe('客户端配置接口', () => {
  it('每个入口都同时带上 clientKey 与 filePath，不留「只凭 id 写任意文件」的口子', async () => {
    await clientConfigApi.getFile('claude-code', 'C:/Users/x/.claude/settings.json')
    expect(lastCall()).toEqual({ path: '/client-config/get', body: { clientKey: 'claude-code', filePath: 'C:/Users/x/.claude/settings.json' } })

    await clientConfigApi.preview('claude-code', 'C:/Users/x/.claude/settings.json', { model: 'gpt-4o', smallModel: 'gpt-4o-mini' })
    expect(lastCall()).toEqual({
      path: '/client-config/preview',
      body: { clientKey: 'claude-code', filePath: 'C:/Users/x/.claude/settings.json', model: 'gpt-4o', smallModel: 'gpt-4o-mini' },
    })

    await clientConfigApi.save('claude-code', 'C:/Users/x/.claude/settings.json', '{}', '改模型')
    expect(lastCall()).toEqual({
      path: '/client-config/save',
      body: { clientKey: 'claude-code', filePath: 'C:/Users/x/.claude/settings.json', content: '{}', note: '改模型' },
    })
  })

  // 不传 clientKey 是「全部客户端」，传了才是列表行内那一颗。
  it('一键生效不带 clientKey 时下发 undefined，服务端按「全部」处理', async () => {
    await clientConfigApi.fill()

    expect(lastCall()).toEqual({ path: '/client-config/fill', body: {} })
  })

  it('版本列表与还原都按文件定位', async () => {
    await clientConfigApi.listVersions('claude-code', 'C:/f.json')
    expect(lastCall()).toEqual({ path: '/client-config/versions', body: { clientKey: 'claude-code', filePath: 'C:/f.json' } })

    await clientConfigApi.restoreVersion('claude-code', 'C:/f.json', 'ver_1')
    expect(lastCall()).toEqual({ path: '/client-config/version/restore', body: { clientKey: 'claude-code', filePath: 'C:/f.json', id: 'ver_1' } })
  })
})

describe('云同步接口', () => {
  it('五个动作各自一条路径', async () => {
    await cloudSyncApi.status()
    expect(capturedPath()).toBe('/cloud-sync/status')

    await cloudSyncApi.configure({ provider: 'webdav', url: 'https://dav.example.com', username: 'u', password: 'p' } as never)
    expect(capturedPath()).toBe('/cloud-sync/configure')

    await cloudSyncApi.test()
    expect(capturedPath()).toBe('/cloud-sync/test')

    await cloudSyncApi.push()
    expect(capturedPath()).toBe('/cloud-sync/push')

    await cloudSyncApi.pull()
    expect(capturedPath()).toBe('/cloud-sync/pull')
  })
})

describe('unwrap', () => {
  it('成功信封取出 data', async () => {
    await expect(unwrap(Promise.resolve({ success: true as const, data: { id: 'prov_1' } }))).resolves.toEqual({ id: 'prov_1' })
  })

  // 抛出携带错误码的 ApiRequestError 而不是 `new Error(errorMessage)`：
  // 界面文案要按错误码本地化，英文原文只留作诊断。
  it('失败信封转成 ApiRequestError，错误码与诊断原文都在', async () => {
    const failure = unwrap(Promise.resolve({ success: false as const, errorCode: 'NOT_FOUND', errorMessage: 'provider not found: prov_x' }))

    await expect(failure).rejects.toBeInstanceOf(ApiRequestError)
    await expect(failure).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      diagnosticMessage: 'provider not found: prov_x',
    })
  })

  it('原样向上传递拒绝，不吞掉网络异常', async () => {
    await expect(unwrap(Promise.reject(new Error('Failed to fetch')))).rejects.toThrow('Failed to fetch')
  })
})
