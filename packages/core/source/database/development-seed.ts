import type { SecretStore } from '@common/secret-store'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_ID, type RequestRewriteRule } from '@common/schemas'
import { PRESET_CONDITIONAL_SCRIPT_CODE } from '@common/rewrite-script-samples'
import { generateId } from '@common/utils'
import { and, eq, inArray } from 'drizzle-orm'
import { getConfigDb, getDataDb } from './index'
import { mapLogicalModelIdsToRecordIds } from './logical-model-store'
import {
  logicalModels,
  providerEndpoints,
  providerModelEndpoints,
  providerModelRequestRewriteRules,
  providerModels,
  providerSettings,
  providers,
  requestRewriteRules,
  schedulingPolicies,
} from './config-schema'
import {
  attemptContents,
  attemptUsages,
  providerHealth,
  providerModelHealth,
  requestAttempts,
  requestContents,
  requestLogs,
  requestUsages,
} from './data-schema'

const PROVIDER_FIXTURES = [
  {
    id: 'prov_dev_openai',
    name: 'OpenAI',
    legacyName: 'OpenAI（开发示例）',
    apiKeyReference: 'key_dev_openai',
    apiKey: 'sk-development-openai',
    endpoints: {
      'openai-completions': 'https://api.openai.com/v1/chat/completions',
      'openai-responses': 'https://api.openai.com/v1/responses',
    },
  },
  {
    id: 'prov_dev_anthropic',
    name: 'Anthropic',
    legacyName: 'Anthropic（开发示例）',
    apiKeyReference: 'key_dev_anthropic',
    apiKey: 'sk-development-anthropic',
    endpoints: {
      'anthropic-messages': 'https://api.anthropic.com/v1/messages',
    },
  },
  {
    id: 'prov_dev_ark',
    name: 'Volcengine Ark',
    // `legacyName` 用于按 id 就地重命名：库里同一 id 的行可能仍带着这个名字，
    // 匹配得上才能就地升级，否则会多出一行。
    legacyName: '火山方舟（开发示例）',
    apiKeyReference: 'key_dev_ark',
    apiKey: 'development-ark-key',
    endpoints: {
      'openai-completions': 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      'openai-responses': 'https://ark.cn-beijing.volces.com/api/v3/responses',
    },
  },
  {
    id: 'prov_dev_deepseek',
    name: 'DeepSeek',
    legacyName: 'DeepSeek（开发示例）',
    apiKeyReference: 'key_dev_deepseek',
    apiKey: 'sk-development-deepseek',
    endpoints: {
      'openai-completions': 'https://api.deepseek.com/chat/completions',
    },
  },
] as const

/**
 * 已软删除的供应商 fixture。
 *
 * 单独列一份，是因为它描述的是**历史**，而不是「本机的第五家供应商」：这些行插进去就带着
 * `deletedTime`，`listProviders()` 默认看不见它们；但它们名下的请求记录、尝试快照与用量是真实
 * 发生过的事。删配置只该让它从「可调度」的列表里消失，不该让观测页面上这段历史一起蒸发
 * ——观测库里的每一行都是请求当时落下的事实，与配置库此刻还留着什么无关。
 *
 * 注意命名：这里说的是**本机配置被软删除**（用户点删、行留着 `deletedTime`），不是「模型版本
 * 退役」那种上游厂商停服。两者是完全不同的生命周期，不要用 `retired` 之类的词去称呼它。
 *
 * （`legacyName` 与活跃 fixture 同义：就地改名的匹配条件是「同一 id + 仍是旧名字」。）
 */
const SOFT_DELETED_PROVIDER_FIXTURES = [
  {
    id: 'prov_dev_deleted',
    name: 'Deleted Demo Provider',
    legacyName: 'Deleted Demo Provider（开发示例）',
    apiKeyReference: 'key_dev_deleted',
    apiKey: 'sk-development-deleted',
    endpoints: {
      'openai-responses': 'https://api.deleted-demo.example.com/v1/responses',
    },
  },
] as const

/** 参与请求归因、健康状态与就地改名的全部供应商 fixture：活跃的在前，已软删除的在后。 */
const ALL_PROVIDER_FIXTURES = [...PROVIDER_FIXTURES, ...SOFT_DELETED_PROVIDER_FIXTURES] as const

const SOFT_DELETED_PROVIDER_IDS = new Set<string>(SOFT_DELETED_PROVIDER_FIXTURES.map(provider => provider.id))

const PROVIDER_MODEL_FIXTURES = [
  ['default', 'prov_dev_ark', 'doubao-seed-1-6', 'openai-completions', 1],
  ['default', 'prov_dev_openai', 'gpt-4.1-mini', 'openai-responses', 2],
  ['default', 'prov_dev_anthropic', 'claude-sonnet-4', 'anthropic-messages', 3],
  ['default', 'prov_dev_deepseek', 'deepseek-reasoner', 'openai-completions', 4],
  ['default', 'prov_dev_openai', 'o3', 'openai-responses', 5],
  ['default', 'prov_dev_ark', 'doubao-seed-1-6-flash', 'openai-completions', 6],
  ['default', 'prov_dev_deepseek', 'deepseek-chat', 'openai-completions', 7],
  // 挂在已软删除供应商名下、自己也已软删除的模型：它的历史请求必须照样能被检索与统计到，
  // 否则「这个模型以前用过多少」在配置删掉之后就再也答不上来。
  ['default', 'prov_dev_deleted', 'deleted-demo-model', 'openai-responses', 8],
] as const

/**
 * 已软删除模型 fixture 的下标：端点 / 绑定 / 调度策略与断言都靠它定位，免得再写一遍魔数。
 *
 * 按**模型名**找而不是取末位：这份 fixture 允许继续往下追加成员，删掉的那个也就不必永远
 * 钉在数组末尾（追加会让「取末位」指到别人身上）。
 */
const SOFT_DELETED_PROVIDER_MODEL_INDEX = PROVIDER_MODEL_FIXTURES.findIndex(fixture => fixture[2] === 'deleted-demo-model')

/**
 * 逻辑模型 fixture：除启动时内建的 `default` 之外，再建两条按用途分的队列，让逻辑模型页
 * 有多列可看。`default` 是兜底、永远在第一位（见 `docs/specs/route-workbench.md`），
 * 这里只补 `sortOrder` 比它大的展示顺序。
 */
const LOGICAL_MODEL_FIXTURES = [
  { modelId: 'fast', description: 'Low-latency tier — flash and mini models first.', sortOrder: 1 },
  { modelId: 'reasoning', description: 'Reasoning tier — long-think models for hard problems.', sortOrder: 2 },
] as const

/**
 * 额外交给非默认逻辑模型的供应商模型（`providerModelIndex` 是 `PROVIDER_MODEL_FIXTURES` 的下标）。
 *
 * 同一个供应商模型同时挂在多条队列上是正常的：逻辑模型是**队列**，供应商模型是**资源池**，
 * 一条队列是否包含某个资源与别的队列无关——这正是逻辑模型页能摆出多列的原因。
 */
const LOGICAL_MODEL_MEMBERSHIP_FIXTURES = [
  { logicalModelId: 'fast', providerModelIndex: 5, priority: 1 },
  { logicalModelId: 'fast', providerModelIndex: 1, priority: 2 },
  { logicalModelId: 'reasoning', providerModelIndex: 3, priority: 1 },
  { logicalModelId: 'reasoning', providerModelIndex: 2, priority: 2 },
] as const

/**
 * 请求记录落在哪个逻辑模型：带专属队列的供应商模型轮流落在 `default` 与它的队列上，
 * 其余仍是 `default`。没有这一层，请求记录页永远只有 `default` 一个逻辑模型，
 * 看不出逻辑模型之间的分流。
 */
const REQUEST_LOGICAL_MODEL_QUEUES: Record<number, readonly string[]> = {
  1: ['default', 'fast'],
  2: ['default', 'reasoning'],
  3: ['default', 'reasoning'],
  5: ['default', 'fast'],
}

/**
 * 请求重写规则 fixture：让开发库里**真的有规则、也真的被命中过**。
 *
 * 三条规则各演示一种形态，也各自解释请求日志里会长出什么：全局 Header 改写对所有模型生效、
 * 模型绑定的 Body 删除只在该模型上生效、脚本动作演示「先读正文再决定改不改」。没有这一块，
 * 开发环境的规则页是空的，请求日志里那排命中的 chip 也永远无话可说。
 *
 * 规则名照供应商 / 模型 fixture 的惯例写英文：它落库后就是用户自己的数据，不随界面语言变化
 * ——本文件因此被 `eslint.config.js` 豁免了 CJK 门禁，豁免的用意是「这里出现的中文是数据」，
 * 不是「这里可以随手写中文」。
 */
interface RewriteRuleFixture {
  id: string
  name: string
  description: string
  /** `global` 对所有模型自动生效；`model` 要在下面的绑定表里挂到某个供应商模型上。 */
  scope: 'global' | 'model'
  match: RequestRewriteRule['match']
  actions: RequestRewriteRule['actions']
  testCases: RequestRewriteRule['testCases']
}

/** 试跑用例：三个 fixture 共用同一套协议与形态，只有正文不同。 */
function rewriteRuleTestCase(ruleId: string, body: string): RequestRewriteRule['testCases'][number] {
  return {
    id: `${ruleId}-testcase-0`,
    name: 'Sample request',
    stage: 'request',
    headers: '{\n  "content-type": "application/json"\n}',
    body,
    clientProtocol: 'openai-completions',
    upstreamProtocol: 'openai-completions',
    transport: 'http',
  }
}

const REWRITE_RULE_FIXTURES: readonly RewriteRuleFixture[] = [
  {
    id: 'rule_dev_probe_header',
    name: 'Stamp a probe header',
    description: 'Add x-osw-probe to every forwarded request so a mock upstream can tell the seed traffic apart.',
    scope: 'global',
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ stage: 'request', type: 'header-set', name: 'x-osw-probe', value: 'development-seed' }],
    testCases: [rewriteRuleTestCase('rule_dev_probe_header', '{\n  "model": "doubao-seed-1-6",\n  "messages": [{ "role": "user", "content": "hello" }]\n}')],
  },
  {
    id: 'rule_dev_drop_debug_flag',
    name: 'Drop the debug flag',
    description: 'Remove the debug flag clients attach while developing, so it never reaches the upstream.',
    scope: 'model',
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ stage: 'request', type: 'body-delete', path: '$.debug' }],
    testCases: [rewriteRuleTestCase('rule_dev_drop_debug_flag', '{\n  "model": "doubao-seed-1-6",\n  "debug": true,\n  "messages": [{ "role": "user", "content": "hello" }]\n}')],
  },
  {
    id: 'rule_dev_strict_temperature',
    name: 'Force temperature for strict requests',
    description: 'Run the built-in conditional script: requests that mention "apply-strict" get temperature 0, the rest pass through untouched.',
    scope: 'model',
    match: { clientProtocols: [], upstreamProtocols: [] },
    // 脚本取自 `@common/rewrite-script-samples`：这是会被沙箱真正执行的代码，与「写一段脚本」
    // 模板共用同一份字符串，测试跑的也是它 —— 不在种子文件里另抄一段迟早会漂移的文本。
    actions: [{ stage: 'request', type: 'script', code: PRESET_CONDITIONAL_SCRIPT_CODE, timeoutMilliseconds: 1000 }],
    testCases: [rewriteRuleTestCase('rule_dev_strict_temperature', '{\n  "model": "doubao-seed-1-6",\n  "temperature": 0.9,\n  "messages": [{ "role": "user", "content": "apply-strict please" }]\n}')],
  },
]

/**
 * 规则绑定：把 `model` 作用域的规则挂到某个供应商模型上，`priority` 就是它的执行顺序。
 *
 * 两条都挂在 `model_dev_provider_1`（火山方舟的 `doubao-seed-1-6`）上，是因为下面的请求 fixture
 * 正好让这个模型既中全局 Header、又中绑定的 Body 删除与脚本 —— 一条链上的三件事在同一个模型上
 * 就都看得见。
 */
const REWRITE_RULE_BINDINGS = [
  { providerModelId: 'model_dev_provider_1', ruleId: 'rule_dev_drop_debug_flag', priority: 1 },
  { providerModelId: 'model_dev_provider_1', ruleId: 'rule_dev_strict_temperature', priority: 2 },
] as const

/**
 * 请求命中规则 id 的落库事实。
 *
 * 与上面的**配置**分开写：绑定回答「此刻规则挂在谁身上」，这里是「那次请求当时命中了哪些」。
 * 配置后来被改掉或删掉，都不该改写已经发生过的命中记录，因此这里按请求直接算，不查配置库。
 *
 * 「命中」是「这条规则跑过」，而不是「它改动了东西」：脚本没命中条件时什么都不返回，规则本身
 * 也确实被应用过，照样要记进来。
 */
const GLOBAL_REWRITE_RULE_IDS = ['rule_dev_probe_header'] as const
const BOUND_REWRITE_RULE_IDS_BY_PROVIDER_MODEL: Record<string, readonly string[]> = {
  model_dev_provider_1: ['rule_dev_drop_debug_flag', 'rule_dev_strict_temperature'],
}

const DEVELOPMENT_REQUEST_COUNT = 120

interface DevelopmentSeedOptions {
  allowExisting?: boolean
}

export async function seedDevelopmentData(secretStore: SecretStore, options: DevelopmentSeedOptions = {}): Promise<boolean> {
  const config = getConfigDb()
  const data = getDataDb()
  // 注意：logical_models 不参与判断 —— 初始化时会自动创建 default 逻辑模型，不代表用户已有配置
  // 「有没有配置」要两边一起看：只配了供应商算配置，只留下请求记录也算。
  const hasConfiguration = Boolean(
    config.select({ id: providers.id }).from(providers).limit(1).get()
    || data.select({ id: requestLogs.id }).from(requestLogs).limit(1).get(),
  )
  if (hasConfiguration && !options.allowExisting) return false

  const fixtureProviderIds = ALL_PROVIDER_FIXTURES.map(provider => provider.id)
  const fixtureProviderModelIds = PROVIDER_MODEL_FIXTURES.map((_, index) => `model_dev_provider_${index + 1}`)
  const existingProviderIds = new Set(
    config.select({ id: providers.id }).from(providers).where(inArray(providers.id, fixtureProviderIds)).all().map(row => row.id),
  )
  const existingHealthProviderIds = new Set(
    data.select({ id: providerHealth.providerId }).from(providerHealth).where(inArray(providerHealth.providerId, fixtureProviderIds)).all().map(row => row.id),
  )
  const existingProviderModelIds = new Set(
    config.select({ id: providerModels.id }).from(providerModels).where(inArray(providerModels.id, fixtureProviderModelIds)).all().map(row => row.id),
  )
  // 逻辑模型按**模型名**判存在：内建 `default` 由启动逻辑创建，这里只管 fixture 那两条。
  const existingLogicalModelModelIds = new Set(
    config.select({ modelId: logicalModels.modelId }).from(logicalModels)
      .where(inArray(logicalModels.modelId, LOGICAL_MODEL_FIXTURES.map(fixture => fixture.modelId))).all().map(row => row.modelId),
  )
  // 调度绑定按主键（逻辑模型，供应商模型）判存在：补种时既不重复插一行，也不把用户解绑过的绑回来。
  const existingSchedulingPolicyKeys = new Set(
    config.select({ logicalModelId: schedulingPolicies.logicalModelId, providerModelId: schedulingPolicies.providerModelId })
      .from(schedulingPolicies).all().map(row => `${row.logicalModelId}\u0000${row.providerModelId}`),
  )
  const existingRewriteRuleIds = new Set(
    config.select({ id: requestRewriteRules.id }).from(requestRewriteRules).where(inArray(requestRewriteRules.id, REWRITE_RULE_FIXTURES.map(rule => rule.id))).all().map(row => row.id),
  )
  // 绑定按主键（模型，规则）判存在：补种时既不能重复插一行，也不能把用户主动解绑过的绑回来。
  const existingRewriteRuleBindingKeys = new Set(
    config.select({ providerModelId: providerModelRequestRewriteRules.providerModelId, ruleId: providerModelRequestRewriteRules.requestRewriteRuleId })
      .from(providerModelRequestRewriteRules).all().map(row => `${row.providerModelId}\u0000${row.ruleId}`),
  )

  for (const provider of ALL_PROVIDER_FIXTURES) {
    if (!existingProviderIds.has(provider.id)) await secretStore.set(provider.apiKeyReference, provider.apiKey)
  }

  const timestamp = Date.now()
  const batchId = `${timestamp.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const providerModelsToInsert = PROVIDER_MODEL_FIXTURES.map((fixture, index) => ({ fixture, index })).filter(({ index }) => !existingProviderModelIds.has(`model_dev_provider_${index + 1}`))
  const logicalModelsToInsert = LOGICAL_MODEL_FIXTURES.filter(fixture => !existingLogicalModelModelIds.has(fixture.modelId))
  // 供应商模型 fixture 第一列写的是**逻辑模型的模型 id**（人看得懂的那种），而
  // `scheduling_policies` 的外键指向的是逻辑模型的**数据记录 id**：两边不是同一把钥匙，
  // 落库前必须先换一次。两条待建队列此刻还没有记录 id，先在本机生成、登记进同一张表。
  const logicalModelRecordIdByModelId = await mapLogicalModelIdsToRecordIds([
    BUILT_IN_DEFAULT_LOGICAL_MODEL_ID,
    ...LOGICAL_MODEL_FIXTURES.map(fixture => fixture.modelId),
  ])
  for (const fixture of logicalModelsToInsert) logicalModelRecordIdByModelId.set(fixture.modelId, generateId('lm_'))
  const defaultLogicalModelRecordId = logicalModelRecordIdByModelId.get(BUILT_IN_DEFAULT_LOGICAL_MODEL_ID)
  if (!defaultLogicalModelRecordId) throw new Error('built-in default logical model is missing; cannot seed scheduling policies')
  // 补种后确定存在的供应商模型：调度绑定只能挂到它们身上，否则外键会指向被用户删掉的行。
  const providerModelIdsAfterSeed = new Set<string>([
    ...existingProviderModelIds,
    ...providerModelsToInsert.map(({ index }) => `model_dev_provider_${index + 1}`),
  ])
  // 调度绑定：内建 `default` 兜底收下全部供应商模型（含已软删除的那个），再按用途补上队列成员。
  const schedulingPolicySeeds = [
    ...PROVIDER_MODEL_FIXTURES.map((fixture, index) => ({
      logicalModelId: BUILT_IN_DEFAULT_LOGICAL_MODEL_ID as string,
      providerModelId: `model_dev_provider_${index + 1}`,
      priority: fixture[4],
      softDeleted: index === SOFT_DELETED_PROVIDER_MODEL_INDEX,
    })),
    ...LOGICAL_MODEL_MEMBERSHIP_FIXTURES.map(membership => ({
      logicalModelId: membership.logicalModelId as string,
      providerModelId: `model_dev_provider_${membership.providerModelIndex + 1}`,
      priority: membership.priority,
      softDeleted: false,
    })),
  ]

  // 两个库、两个事务：SQLite 的事务不能跨文件，配置先写一次、观测数据再写一次。
  config.transaction(transaction => {
    const providersToInsert = ALL_PROVIDER_FIXTURES.filter(provider => !existingProviderIds.has(provider.id))
    if (providersToInsert.length > 0) transaction.insert(providers).values(providersToInsert.map(provider => ({
      id: provider.id,
      name: provider.name,
      description: 'Development sample provider',
      // 已软删除的 fixture 一进来就带删除标：它在可调度列表里从未出现过，但它的历史数据在。
      enabled: !SOFT_DELETED_PROVIDER_IDS.has(provider.id),
      // 种子行的侧栏顺序照 fixture 数组来：`createdTime` 全都一样，没有序号就没有确定顺序。
      sortOrder: ALL_PROVIDER_FIXTURES.indexOf(provider),
      createdTime: timestamp,
      updatedTime: timestamp,
      deletedTime: SOFT_DELETED_PROVIDER_IDS.has(provider.id) ? timestamp : null,
    }))).run()
    for (const provider of ALL_PROVIDER_FIXTURES.filter(provider => existingProviderIds.has(provider.id))) {
      transaction.update(providers)
        .set({ name: provider.name, updatedTime: timestamp })
        .where(and(eq(providers.id, provider.id), eq(providers.name, provider.legacyName)))
        .run()
    }
    if (providersToInsert.length > 0) transaction.insert(providerSettings).values(providersToInsert.flatMap(provider => [
      { providerId: provider.id, key: 'security.secretReference', value: provider.apiKeyReference, valueType: 'string', updatedTime: timestamp },
      { providerId: provider.id, key: 'connection.timeoutMilliseconds', value: '30000', valueType: 'number', updatedTime: timestamp },
    ])).run()

    if (logicalModelsToInsert.length > 0) {
      // 队列排在 `default` 之后：`sortOrder` 从 1 起，`default`（0）仍是第一列。
      transaction.insert(logicalModels).values(logicalModelsToInsert.map(fixture => ({
        id: logicalModelRecordIdByModelId.get(fixture.modelId)!,
        modelId: fixture.modelId,
        description: fixture.description,
        enabled: true,
        sortOrder: fixture.sortOrder,
        createdTime: timestamp,
        updatedTime: timestamp,
        deletedTime: null,
      }))).run()
    }

    if (providerModelsToInsert.length > 0) {
      transaction.insert(providerModels).values(providerModelsToInsert.map(({ fixture, index }) => ({
        id: `model_dev_provider_${index + 1}`,
        providerId: fixture[1],
        modelName: fixture[2],
        // 已软删除的模型与它的父供应商保持一致：停用 + 打标。
        enabled: index !== SOFT_DELETED_PROVIDER_MODEL_INDEX,
        createdTime: timestamp,
        updatedTime: timestamp,
        deletedTime: index === SOFT_DELETED_PROVIDER_MODEL_INDEX ? timestamp : null,
      }))).run()

      for (const { fixture, index } of providerModelsToInsert) {
        // 已软删除 fixture 的子结构一并打标：与 `deleteProvider` / `deleteProviderModelRoute`
        // 落库后的形状保持一致，读它的人不必区分「种子造出来的删除」与「用户点出来的删除」。
        const softDeleted = index === SOFT_DELETED_PROVIDER_MODEL_INDEX
        const protocols = [fixture[3]]
        for (const protocol of protocols) {
          const endpointId = `endpoint_dev_${fixture[1]}_${protocol}`
          const url = ALL_PROVIDER_FIXTURES.find(provider => provider.id === fixture[1])?.endpoints[protocol as keyof typeof ALL_PROVIDER_FIXTURES[number]['endpoints']] ?? 'https://api.example.com'
          const existingEndpoint = transaction.select().from(providerEndpoints).where(inArray(providerEndpoints.id, [endpointId])).get()
          if (!existingEndpoint) transaction.insert(providerEndpoints).values({ id: endpointId, providerId: fixture[1], protocol, url, enabled: !softDeleted, createdTime: timestamp, updatedTime: timestamp, deletedTime: softDeleted ? timestamp : null }).run()
          transaction.insert(providerModelEndpoints).values({ id: `binding_dev_${index}_${protocol}`, providerModelId: `model_dev_provider_${index + 1}`, providerEndpointId: endpointId, url: null, enabled: !softDeleted, createdTime: timestamp, updatedTime: timestamp, deletedTime: softDeleted ? timestamp : null }).run()
        }
      }
    }

    // 调度绑定不跟着 `providerModelsToInsert` 的分支走：队列的成员关系与「供应商模型这次插没插」
    // 是两件事，模型早就存在（补种）时绑定仍可能缺，得单独补上。
    const schedulingPoliciesToInsert = schedulingPolicySeeds.filter(seed => {
      if (!providerModelIdsAfterSeed.has(seed.providerModelId)) return false
      const logicalModelRecordId = logicalModelRecordIdByModelId.get(seed.logicalModelId)
      if (!logicalModelRecordId) return false
      return !existingSchedulingPolicyKeys.has(`${logicalModelRecordId}\u0000${seed.providerModelId}`)
    })
    if (schedulingPoliciesToInsert.length > 0) {
      transaction.insert(schedulingPolicies).values(schedulingPoliciesToInsert.map(seed => ({
        logicalModelId: logicalModelRecordIdByModelId.get(seed.logicalModelId)!,
        providerModelId: seed.providerModelId,
        priority: seed.priority,
        weight: 100,
        enabled: !seed.softDeleted,
        createdTime: timestamp,
        updatedTime: timestamp,
        deletedTime: seed.softDeleted ? timestamp : null,
      }))).run()
    }

    // 规则本体独立于供应商模型，因此不跟着 `providerModelsToInsert` 的分支走：模型早就存在
    // （补种）时，规则仍然要补上，否则新增 fixture 的升级路径会少一半。
    const rewriteRulesToInsert = REWRITE_RULE_FIXTURES.filter(rule => !existingRewriteRuleIds.has(rule.id))
    if (rewriteRulesToInsert.length > 0) {
      transaction.insert(requestRewriteRules).values(rewriteRulesToInsert.map(rule => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        // 种子规则与手写规则完全等价：可编辑、可停用、可删除。`source: 'user'` 正是这个意思
        // ——`builtin` 那一档要回答的是「从模板起手的规则有人用吗」，不该被种子数据污染。
        enabled: true,
        scope: rule.scope,
        schemaVersion: 1,
        source: 'user',
        match: JSON.stringify(rule.match),
        actions: JSON.stringify(rule.actions),
        testCases: JSON.stringify(rule.testCases),
        createdTime: timestamp,
        updatedTime: timestamp,
        deletedTime: null,
      }))).run()
    }
    const rewriteRuleBindingsToInsert = REWRITE_RULE_BINDINGS.filter(binding => !existingRewriteRuleBindingKeys.has(`${binding.providerModelId}\u0000${binding.ruleId}`))
    if (rewriteRuleBindingsToInsert.length > 0) {
      transaction.insert(providerModelRequestRewriteRules).values(rewriteRuleBindingsToInsert.map(binding => ({
        providerModelId: binding.providerModelId,
        requestRewriteRuleId: binding.ruleId,
        priority: binding.priority,
        enabled: true,
        createdTime: timestamp,
        updatedTime: timestamp,
        deletedTime: null,
      }))).run()
    }
  })

  data.transaction(transaction => {
    // 供应商改名时，历史尝试里冗余存着的名字要跟着走：那是同一件事的两份落库位置。
    for (const provider of ALL_PROVIDER_FIXTURES.filter(provider => existingProviderIds.has(provider.id))) {
      transaction.update(requestAttempts)
        .set({ providerName: provider.name })
        .where(and(eq(requestAttempts.providerId, provider.id), eq(requestAttempts.providerName, provider.legacyName)))
        .run()
    }

    const healthToInsert = ALL_PROVIDER_FIXTURES.filter(provider => !existingHealthProviderIds.has(provider.id))
    if (healthToInsert.length > 0) transaction.insert(providerHealth).values(healthToInsert.map(provider => {
      const index = ALL_PROVIDER_FIXTURES.findIndex(item => item.id === provider.id)
      return {
        providerId: provider.id,
        consecutiveFailures: index === 3 ? 1 : 0,
        lastSuccessTime: timestamp - (index + 1) * 90_000,
        lastFailureTime: index === 3 ? timestamp - 45_000 : null,
        updatedTime: timestamp,
      }
    })).run()
    if (providerModelsToInsert.length > 0) {
      transaction.insert(providerModelHealth).values(providerModelsToInsert.map(({ index }) => ({ providerModelId: `model_dev_provider_${index + 1}`, updatedTime: timestamp }))).run()
    }

    const sampleRequests = Array.from({ length: DEVELOPMENT_REQUEST_COUNT }, (_, index) => {
      const failed = index % 11 === 4
      // 归因**按模型认供应商**：两边各取各的模数会造出「OpenAI 的供应商配火山方舟的模型」
      // 这种库里根本不可能出现的尝试——而尝试快照恰恰是统计查询唯一的事实来源。
      const modelIndex = index % PROVIDER_MODEL_FIXTURES.length
      const providerModelId = `model_dev_provider_${modelIndex + 1}`
      const provider = ALL_PROVIDER_FIXTURES.find(item => item.id === PROVIDER_MODEL_FIXTURES[modelIndex][1])!
      // 落在哪个逻辑模型：带专属队列的供应商模型轮流落到 `default` 与它的队列上，其余恒为 `default`。
      const logicalModelQueues = REQUEST_LOGICAL_MODEL_QUEUES[modelIndex]
      const logicalModelId = logicalModelQueues ? logicalModelQueues[index % logicalModelQueues.length] : BUILT_IN_DEFAULT_LOGICAL_MODEL_ID
      // 那次尝试命中的改写规则。全局规则对所有模型生效，因此恒在；绑定的两条只挂在
      // `model_dev_provider_1` 上，于是只有走到这个模型的请求才带它们。
      const requestRewriteRuleIds = [...GLOBAL_REWRITE_RULE_IDS, ...(BOUND_REWRITE_RULE_IDS_BY_PROVIDER_MODEL[providerModelId] ?? [])]
      const duration = 480 + (index * 173) % 2_400
      const inputTokens = 320 + index * 47
      const outputTokens = 80 + (index * 29) % 360
      return {
        id: `req_dev_${batchId}_${String(index + 1).padStart(2, '0')}`,
        logicalModelId,
        protocol: index % 3 === 0 ? 'openai-completions' : index % 3 === 1 ? 'openai-responses' : 'anthropic-messages',
        status: failed ? 'failed' : 'success',
        totalDurationMilliseconds: duration,
        totalTokens: failed ? null : inputTokens + outputTokens,
        inputTokens: failed ? null : inputTokens,
        outputTokens: failed ? null : outputTokens,
        cachedInputTokens: failed ? null : index % 3 === 0 ? 256 : 0,
        cacheCreationInputTokens: failed ? null : index % 5 === 0 ? 128 : 0,
        ttftMilliseconds: failed ? null : 110 + (index * 31) % 420,
        // 客户端跳声明的形态：请求体里就有这个事实。
        transport: index % 4 === 0 ? 'http-stream' as const : 'http' as const,
        createdTime: timestamp - index * 6 * 3_600_000,
        provider,
        providerModelId,
        requestRewriteRuleIds,
        index,
        modelIndex,
        failed,
      }
    })

    transaction.insert(requestLogs).values(sampleRequests.map(request => ({
      id: request.id,
      logicalModelId: request.logicalModelId,
      clientProtocol: request.protocol,
      transport: request.transport,
      status: request.status,
      totalDurationMilliseconds: request.totalDurationMilliseconds,
      createdTime: request.createdTime,
    }))).run()
    const usages: Array<typeof requestUsages.$inferInsert> = sampleRequests.flatMap(request => request.totalTokens == null ? [] : [
      { requestId: request.id, type: 'inputTokens', value: request.inputTokens!, createdTime: request.createdTime },
      { requestId: request.id, type: 'outputTokens', value: request.outputTokens!, createdTime: request.createdTime },
      { requestId: request.id, type: 'cachedInputTokens', value: request.cachedInputTokens!, createdTime: request.createdTime },
      ...(request.index % 4 === 0 ? [{ requestId: request.id, type: 'cacheCreationInputTokens', value: request.cacheCreationInputTokens!, createdTime: request.createdTime }] : []),
      // 原始 usage 报文没有数值，作为 `raw` 类型的行与其他用量并存。
      {
        requestId: request.id,
        type: 'raw',
        value: null,
        rawValue: JSON.stringify({ prompt_tokens: request.inputTokens, completion_tokens: request.outputTokens, total_tokens: request.totalTokens, prompt_tokens_details: { cached_tokens: request.cachedInputTokens } }),
        createdTime: request.createdTime,
      },
    ])
    if (usages.length > 0) transaction.insert(requestUsages).values(usages).run()
    transaction.insert(requestAttempts).values(sampleRequests.flatMap(request => {
      const fixture = PROVIDER_MODEL_FIXTURES[request.modelIndex]
      const providerModelId = request.providerModelId
      // 开发示例：客户端跳要增量时，上游跳也以 SSE 返回（忠诚转发的典型情形）。
      const upstreamTransport = request.transport === 'http-stream' ? 'http-stream' as const : 'http' as const
      const attempt = {
        id: `att_dev_${request.id}`,
        requestId: request.id,
        providerId: request.provider.id,
        providerModelId,
        providerName: request.provider.name,
        providerModelName: fixture[2],
        upstreamProtocol: fixture[3],
        upstreamRequestId: null,
        url: '',
        status: request.status,
        httpStatus: request.failed ? 504 : 200,
        retryable: request.failed,
        attemptIndex: 0,
        // 上游跳实际是什么形态。本行最终失败的尝试根本没等到响应，因此无从判断。
        upstreamTransport: request.failed ? null : upstreamTransport,
        errorCode: request.failed ? 'UPSTREAM_TIMEOUT' : null,
        errorMessage: request.failed ? 'Development sample: upstream request timed out' : null,
        durationMilliseconds: request.totalDurationMilliseconds,
        ttftMilliseconds: request.ttftMilliseconds,
        // 事实总是写入，与是否采集正文无关。响应阶段整段关在 `RESPONSE_REWRITE_ENABLED` 后面，
        // 因此响应侧永远是空的 —— fixture 要和闸门的真实状态一致，而不是摆一份「看起来有响应
        // 规则」的假数据。
        requestRewriteRuleIds: JSON.stringify(request.requestRewriteRuleIds),
        responseRewriteRuleIds: JSON.stringify([]),
        createdTime: request.createdTime,
      }
      if (!request.failed) return [attempt]
      return [
        { ...attempt, id: `att_dev_${request.id}_retry`, status: 'success', httpStatus: 200, retryable: false, attemptIndex: 1, upstreamTransport, errorCode: null, errorMessage: null, durationMilliseconds: request.totalDurationMilliseconds + 640 },
        { ...attempt, attemptIndex: 0 },
      ]
    })).run()
    // 尝试级用量：归属由 attemptId 唯一确定，请求级用量在另一张表里。
    const attemptUsageRows: Array<typeof attemptUsages.$inferInsert> = sampleRequests.flatMap(request => request.totalTokens == null ? [] : [
      { attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`, type: 'inputTokens', value: request.inputTokens!, createdTime: request.createdTime },
      { attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`, type: 'outputTokens', value: request.outputTokens!, createdTime: request.createdTime },
      { attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`, type: 'cachedInputTokens', value: request.cachedInputTokens!, createdTime: request.createdTime },
      {
        attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`,
        type: 'raw',
        value: null,
        rawValue: JSON.stringify({ prompt_tokens: request.inputTokens, completion_tokens: request.outputTokens, total_tokens: request.totalTokens }),
        createdTime: request.createdTime,
      },
    ])
    if (attemptUsageRows.length > 0) transaction.insert(attemptUsages).values(attemptUsageRows).run()
    transaction.insert(requestContents).values(sampleRequests.flatMap(request => {
      const responseBody = request.failed
        ? JSON.stringify({ error: { type: 'upstream_timeout', message: 'Development sample: upstream request timed out' } })
        : JSON.stringify({ id: `chatcmpl-dev-${request.id}`, object: 'chat.completion', model: request.provider.name, choices: [{ index: 0, message: { role: 'assistant', content: 'This is a sample response generated by the development seeder.' }, finish_reason: 'stop' }], usage: { prompt_tokens: request.inputTokens, completion_tokens: request.outputTokens, total_tokens: request.totalTokens } })
      // 命中脚本规则的请求要能看出「它凭什么命中」：正文里就有那个标记。
      const strictRequest = request.requestRewriteRuleIds.includes('rule_dev_strict_temperature')
      const requestBody = JSON.stringify({ model: request.provider.name, messages: [{ role: 'user', content: strictRequest ? 'apply-strict: summarize this development sample content.' : request.index % 3 === 0 ? 'Summarize this development sample content.' : 'Write a short development sample reply.' }], temperature: request.index % 2 === 0 ? 0.7 : 0.2, stream: request.index % 4 === 0 })
      const captureStatus = request.failed
        ? 'partial'
        : request.index % 11 === 0
          ? 'partial'
          : request.index % 7 === 0
            ? 'partial'
            : 'captured'
      // 客户端视角：每个请求一行，只描述客户端看到的内容。
      return [{
        id: `content_dev_${request.id}`,
        requestId: request.id,
        captureStatus,
        requestMethod: 'POST',
        requestPath: request.protocol === 'anthropic-messages' ? '/v1/messages' : '/v1/chat/completions',
        requestHeaders: JSON.stringify({ 'content-type': 'application/json', authorization: '[REDACTED]', 'x-development-batch': request.index % 2 === 0 ? 'standard' : 'extended' }),
        requestBody,
        responseStatus: request.failed ? 504 : 200,
        responseHeaders: JSON.stringify({ 'content-type': 'application/json', 'x-request-id': `req-${request.id}` }),
        responseBody,
        createdTime: request.createdTime,
        updatedTime: request.createdTime,
      }]
    }).flat()).run()
    transaction.insert(attemptContents).values(sampleRequests.filter(request => request.index % 4 === 0).map(request => {
      // 上游视角：每次尝试一行，只描述真正发给供应商 / 由供应商返回的内容。
      // 这里也把两条规则的效果写进去：全局那条加了探针头，脚本那条把 temperature 压到 0。
      const strictRequest = request.requestRewriteRuleIds.includes('rule_dev_strict_temperature')
      return {
        id: `attempt_content_dev_${request.id}`,
        attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`,
        captureStatus: request.failed ? 'captured' : 'partial',
        requestHeaders: JSON.stringify({ 'content-type': 'application/json', authorization: '[REDACTED]', 'x-upstream-attempt': 'development-seed', 'x-osw-probe': 'development-seed' }),
        requestBody: JSON.stringify({ model: request.provider.name, messages: [{ role: 'user', content: strictRequest ? 'apply-strict: this is an attempt-level request body.' : 'This is an attempt-level request body.' }], temperature: strictRequest ? 0 : 0.2, stream: true }),
        responseStatus: request.failed ? 504 : 200,
        responseHeaders: JSON.stringify({ 'content-type': 'application/json', 'x-upstream-request-id': `upstream-${request.id}` }),
        responseBody: JSON.stringify({ id: `attempt-${request.id}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'This is an attempt-level response.' } }] }),
        createdTime: request.createdTime,
        updatedTime: request.createdTime,
      }
    })).run()
  })

  return true
}
