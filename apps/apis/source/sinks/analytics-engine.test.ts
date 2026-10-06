import { describe, expect, it } from 'vitest'
import {
  TELEMETRY_ENVELOPE_FIELDS,
  TELEMETRY_MAX_EVENTS_PER_BATCH,
  TELEMETRY_MAX_PROPERTY_VALUE_LENGTH,
  TelemetryEventSchema,
  type TelemetryEvent,
  type TelemetryEventName,
} from '@common/telemetry'
import {
  ANALYTICS_ENGINE_BLOB_SLOTS,
  ANALYTICS_ENGINE_DATASET,
  ANALYTICS_ENGINE_ENVELOPE_DESTINATIONS,
  ANALYTICS_ENGINE_INDEX_MAX_BYTES,
  ANALYTICS_ENGINE_MAX_BLOB_BYTES,
  ANALYTICS_ENGINE_MAX_BLOBS,
  ANALYTICS_ENGINE_MAX_DATA_POINTS_PER_INVOCATION,
  createAnalyticsEngineSink,
  dataPointOf,
  type AnalyticsEngineDataPoint,
} from './analytics-engine'
import type { TelemetryForwardContext } from '../sink'

const NOW = 1_700_000_000_000
const INSTALL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const CONTEXT: TelemetryForwardContext = { receivedAt: NOW, countryCode: 'DE' }

/**
 * 契约里的字段分成三拨，每拨只有一处真相。
 *
 * 这份名单**从 schema 里算出来**，不是手抄的：手抄的名单会在契约加字段时保持沉默，而它沉默的
 * 时候正好是这里该出声的时候。
 */
const EVENT_SHAPES = TelemetryEventSchema.options as readonly { shape: Record<string, unknown> }[]

/** 全部事件名。 */
const EVENT_NAMES = EVENT_SHAPES.map(option => (option.shape.name as { value: TelemetryEventName }).value)

/**
 * 每一个事件属性的名字（信封字段与判别字段 `name` 之外的全部）。跨事件取并集，去重。
 *
 * `name` 要单独排掉：它是**判别字段**而不是事件属性，而它在契约里不在
 * `TELEMETRY_ENVELOPE_FIELDS` 上（那个常量只列信封）。它的去处是 `event` 列，在
 * `ANALYTICS_ENGINE_ENVELOPE_DESTINATIONS` 里单独表过态。
 */
const PROPERTY_KEYS = [...new Set(EVENT_SHAPES.flatMap(option =>
  Object.keys(option.shape).filter(key =>
    key !== 'name' && !(TELEMETRY_ENVELOPE_FIELDS as readonly string[]).includes(key))))].sort()

/**
 * 落成列的**信封与边缘**字段（`event` / `version` / … / `country`）。
 *
 * 它从 `ANALYTICS_ENGINE_ENVELOPE_DESTINATIONS` 推出来而不是手抄：那份映射是「信封字段去哪」
 * 的唯一真相，而下面两条用例要的正是「属性列 = 全部列 - 这份名单」。手抄一份就会出现
 * 「改了映射、名单没跟上」这种两份真相各说各话的情形。
 */
const ENVELOPE_COLUMNS = new Set<string>(
  Object.values(ANALYTICS_ENGINE_ENVELOPE_DESTINATIONS).filter(destination => destination !== 'index' && destination !== 'dropped'),
)

/**
 * 既不是契约字段也不是事件属性的列：它们的值来自**服务端事实**（
 * `TelemetryForwardContext`），客户端根本没机会提供。
 *
 * 列在这里是为了让下一条用例能干净地排除它们，而不是因为它可以含糊过去——`country` 之所以
 * 能落成列，正是 `apps/apis/source/index.ts` 从 `CF-IPCountry` 里读出来再交给 sink 的。
 */
const SERVER_SIDE_COLUMNS = new Set(['country'])

/** 绑定替身：把写出来的数据点收起来。 */
function createBinding(throws = false): { binding: { writeDataPoint(point: AnalyticsEngineDataPoint): void }; points: AnalyticsEngineDataPoint[] } {
  const points: AnalyticsEngineDataPoint[] = []
  return {
    binding: {
      writeDataPoint(point) {
        if (throws) throw new Error('dataset unavailable')
        points.push(point)
      },
    },
    points,
  }
}

/** 走一次转发并取回第一个数据点——绝大多数断言只关心它。 */
async function forwardOne(event: TelemetryEvent, context = CONTEXT) {
  const upstream = createBinding()
  const sink = createAnalyticsEngineSink({ dataset: upstream.binding })

  const outcome = await sink.forward([event], context)

  return { outcome, upstream, point: upstream.points[0] }
}

/**
 * 造一条**形状上合法、取值上顶格**的事件：字符串取契约允许的最长值、枚举取第一项。
 *
 * 取值是机械推出来的而不是逐个手写，所以「契约放宽了某个上限」这类改动会在这里自动反映出来
 * ——下面那条「最坏情况的数据点」用例靠的正是这一点。
 */
function syntheticEvent(name: TelemetryEventName): TelemetryEvent {
  const shape = EVENT_SHAPES.find(option => (option.shape.name as { value: string }).value === name)?.shape
  if (shape === undefined) throw new Error(`事件 ${name} 不在契约里`)

  const event: Record<string, unknown> = { name }
  for (const [key, field] of Object.entries(shape)) {
    if (key === 'name') continue
    if (key === 'occurredAt') event[key] = NOW - 1_000
    // 安装标识必须是真的 UUID：它是 index，而 index 的形状（36 字符）是下面一条用例在验的东西。
    else if (key === 'installId') event[key] = INSTALL_ID
    else if (isBooleanField(field)) event[key] = true
    else event[key] = longestValueOf(field)
  }
  return event as unknown as TelemetryEvent
}

/** 从 zod 字段里读它的类型名。这里只看两种：枚举（`ZodEnum`）与布尔（`ZodBoolean`）。 */
function typeNameOf(field: unknown): string {
  return (field as { _def?: { typeName?: string } })._def?.typeName ?? ''
}

function isBooleanField(field: unknown): boolean {
  return typeNameOf(field) === 'ZodBoolean'
}

/** 一个字段允许的最长取值：枚举取它最长的一项，其余按契约的属性值上限顶格。 */
function longestValueOf(field: unknown): string {
  const def = (field as { _def?: { typeName?: string; values?: string[]; checks?: { kind: string; value: number }[] } })._def
  if (def?.typeName === 'ZodEnum') {
    return [...(def.values ?? [])].sort((a, b) => b.length - a.length)[0] ?? ''
  }
  // 唯一的另一个上限来源是 `max(TELEMETRY_MAX_PROPERTY_VALUE_LENGTH)`；没有 checks 的按上限算。
  const max = def?.checks?.find(check => check.kind === 'max')?.value ?? TELEMETRY_MAX_PROPERTY_VALUE_LENGTH
  return 'x'.repeat(max)
}

describe('Analytics Engine 下游', () => {
  describe('与契约对齐', () => {
    /**
     * 这一组是这一层唯一真正需要人的地方：blob 的列是**位置**，而位置写死在
     * `ANALYTICS_ENGINE_BLOB_SLOTS` 里。契约与它之间任何一处不对齐，后果都是静默的
     * ——要么某个属性永远读不出来，要么某一列永远是空的。所以这里逐项机械核对。
     */
    it('契约里的每一个事件属性都有一列', () => {
      const slotted = new Set(ANALYTICS_ENGINE_BLOB_SLOTS.map(slot => slot.key))

      // 少了任何一项都意味着那个属性的值永远进不了库。
      expect(PROPERTY_KEYS.filter(key => !slotted.has(key))).toEqual([])
    })

    it('没有多余的列', () => {
      // 只看**属性**那一段：信封与边缘的列有它们自己的去处，来源国家是服务端事实。
      // 多出来的属性列永远是空串，而它会让人以为事件真的带了这个属性。
      const propertySlots = ANALYTICS_ENGINE_BLOB_SLOTS
        .map(slot => slot.key)
        .filter(key => !ENVELOPE_COLUMNS.has(key) && !SERVER_SIDE_COLUMNS.has(key))

      expect(propertySlots.filter(key => !PROPERTY_KEYS.includes(key))).toEqual([])
    })

    it('服务端事实的列也真的在列里', () => {
      const slotted = new Set(ANALYTICS_ENGINE_BLOB_SLOTS.map(slot => slot.key))

      expect([...SERVER_SIDE_COLUMNS].filter(column => !slotted.has(column))).toEqual([])
    })

    it('契约里每一个不是属性的字段都有一个明确的去处——落列、当 index，或被有意丢掉', () => {
      const destinations = Object.keys(ANALYTICS_ENGINE_ENVELOPE_DESTINATIONS)

      // `name` 不是信封字段（它是判别字段），所以它要单独加上去；它的去处是 `event` 列。
      // `occurredAt` 落在 `dropped` 上，那是一个**决定**而不是遗漏（理由见适配器文件头）。
      // 这条用例的价值在于：契约将来新增一个信封字段时，它必须先在这里被表过态。
      expect([...TELEMETRY_ENVELOPE_FIELDS, 'name'].sort()).toEqual([...destinations].sort())
      expect(ANALYTICS_ENGINE_ENVELOPE_DESTINATIONS.name).toBe('event')
      expect(ANALYTICS_ENGINE_ENVELOPE_DESTINATIONS.occurredAt).toBe('dropped')
      expect(ANALYTICS_ENGINE_ENVELOPE_DESTINATIONS.installId).toBe('index')
    })

    it('每一个落列的字段都真的在列里', () => {
      const slotted = new Set(ANALYTICS_ENGINE_BLOB_SLOTS.map(slot => slot.key))

      expect([...ENVELOPE_COLUMNS].filter(column => !slotted.has(column))).toEqual([])
    })

    it('列名互不重复', () => {
      // 两个槽位同名会让其中一个的值被另一个覆盖（`blobValuesOf` 按 key 取值），
      // 而症状是「某一列偶尔有值、偶尔没有」这种最难查的样子。
      expect(new Set(ANALYTICS_ENGINE_BLOB_SLOTS.map(slot => slot.key)).size).toBe(ANALYTICS_ENGINE_BLOB_SLOTS.length)
    })

    it('SQL 别名互不重复，且不撞 SQL 保留字', () => {
      const aliases = ANALYTICS_ENGINE_BLOB_SLOTS.map(slot => slot.alias)

      expect(new Set(aliases).size).toBe(aliases.length)
      // `from` / `to` 是保留字，直接 `AS from` 是语法错误，所以那两个槽位的别名必须换过。
      expect(aliases).not.toContain('from')
      expect(aliases).not.toContain('to')
      expect(aliases).toContain('protocol_from')
      expect(aliases).toContain('protocol_to')
    })

    it('列数在平台上限之内', () => {
      expect(ANALYTICS_ENGINE_BLOB_SLOTS.length).toBeLessThanOrEqual(ANALYTICS_ENGINE_MAX_BLOBS)
    })

    it('单批上限不超过「一次调用最多能写几个数据点」', () => {
      // 撞上它的后果是这条调用里后面的数据点被静默丢掉，而端点仍然回 204。
      expect(TELEMETRY_MAX_EVENTS_PER_BATCH).toBeLessThanOrEqual(ANALYTICS_ENGINE_MAX_DATA_POINTS_PER_INVOCATION)
    })
  })

  describe('数据点', () => {
    it('index 是安装标识，而且只有一个', async () => {
      const { point } = await forwardOne(plainAppStarted())

      // 多给一个 index 的后果是整条数据点被丢掉，不是「取第一个」。
      expect(point.indexes).toEqual([INSTALL_ID])
    })

    it('安装标识装得进 index 的长度上限', () => {
      // 超限的后果同样是整条数据点被静默丢掉，而契约保证 `installId` 是标准 UUID。
      expect(new TextEncoder().encode(INSTALL_ID).length).toBeLessThanOrEqual(ANALYTICS_ENGINE_INDEX_MAX_BYTES)
      // 把「36 个字符」这件事钉在契约上，而不是钉在一个手写的数字上。
      expect(INSTALL_ID).toHaveLength(36)
    })

    it('blob 的条数正好等于列数——不多不少', async () => {
      const { point } = await forwardOne(plainAppStarted())

      // 少写一个会让它后面的每一列都错位一格，而错位是静默的。
      expect(point.blobs).toHaveLength(ANALYTICS_ENGINE_BLOB_SLOTS.length)
    })

    it('一批里几条就是几个数据点，一次调用全交出去', async () => {
      const upstream = createBinding()
      const sink = createAnalyticsEngineSink({ dataset: upstream.binding })

      const outcome = await sink.forward([plainAppStarted(), syntheticEvent('request_completed')], CONTEXT)

      expect(outcome).toEqual({ ok: true })
      expect(upstream.points).toHaveLength(2)
    })

    it('没有 double——所有指标都是计数', async () => {
      const { point } = await forwardOne(plainAppStarted())

      // 这份契约里没有任何数字属性，而 `doubles` 一旦出现就会被误当成可聚合的度量。
      expect(Object.keys(point).sort()).toEqual(['blobs', 'indexes'])
    })

    it('最坏情况的数据点也远在 16 KB 之内', () => {
      // 顶格造一条：每个字符串字段都取契约允许的最长值、枚举取最长的一项。
      const worst = EVENT_NAMES.map(name => {
        const point = dataPointOf(syntheticEvent(name), { receivedAt: NOW, countryCode: 'DE' })
        return new TextEncoder().encode((point.blobs ?? []).join('')).length
      })

      for (const bytes of worst) expect(bytes).toBeLessThan(ANALYTICS_ENGINE_MAX_BLOB_BYTES)
    })
  })

  describe('值的形状', () => {
    /** 取某一列的值（顺序即 `ANALYTICS_ENGINE_BLOB_SLOTS`）。 */
    function slotOf(point: AnalyticsEngineDataPoint, key: string): string | undefined {
      const index = ANALYTICS_ENGINE_BLOB_SLOTS.findIndex(slot => slot.key === key)
      return index === -1 ? undefined : (point.blobs ?? [])[index]
    }

    it('事件名落在 event 列上，而不是 blob 里的 name', async () => {
      const { point } = await forwardOne(plainAppStarted())

      expect(slotOf(point, 'event')).toBe('app_started')
    })

    it('信封字段按自己的列落位', async () => {
      const { point } = await forwardOne(plainAppStarted())

      expect(slotOf(point, 'version')).toBe('1.1.0-beta.14')
      expect(slotOf(point, 'os')).toBe('win32')
      expect(slotOf(point, 'arch')).toBe('x64')
      expect(slotOf(point, 'locale')).toBe('en')
      expect(slotOf(point, 'runtime')).toBe('desktop')
    })

    it('国家有值就用它，拿不到时是空串而不是编一个国家', async () => {
      const known = await forwardOne(plainAppStarted(), { receivedAt: NOW, countryCode: 'DE' })
      const unknown = await forwardOne(plainAppStarted(), { receivedAt: NOW, countryCode: null })

      expect(slotOf(known.point, 'country')).toBe('DE')
      // 空串在每一列上都表示「没有这个值」；退回机房所在地只会得到一个假国家。
      expect(slotOf(unknown.point, 'country')).toBe('')
    })

    it('事件属性按同名落位，枚举值原样', async () => {
      const failed = await forwardOne(syntheticEvent('service_start_failed'))
      const executed = await forwardOne(syntheticEvent('workflow_node_executed'))

      expect(slotOf(failed.point, 'reason')).toBe('instance_lock')
      expect(slotOf(executed.point, 'node_kind')).toBeDefined()
    })

    it('布尔写成 true / false 两个字符串', async () => {
      const { point } = await forwardOne(syntheticEvent('onboarding_finished'))

      // blob 只收字符串，而 JSON 里的布尔在 SQL 侧怎么读回来要看方言；字符串是各方都同意的值。
      expect(slotOf(point, 'skipped')).toBe('true')
    })

    it('这条事件没有的属性是空串，而不是省略', async () => {
      const { point } = await forwardOne(plainAppStarted())

      // 省略会让后面的列全部错位；空串则明确表示「这条事件没有这个值」。
      expect(slotOf(point, 'reason')).toBe('')
      expect(slotOf(point, 'mode')).toBe('')
      expect(slotOf(point, 'node_kind')).toBe('')
    })

    it('协议转换的两侧各自成列', async () => {
      const { point } = await forwardOne(syntheticEvent('protocol_conversion_used'))

      // 契约里叫 `from` / `to`，而那两个是 SQL 保留字，所以读侧的别名换过（见 SLA 表）。
      expect(slotOf(point, 'from')).toBeDefined()
      expect(slotOf(point, 'to')).toBeDefined()
      expect(slotOf(point, 'from')).not.toBe('')
      expect(slotOf(point, 'to')).not.toBe('')
    })

    it('每一条事件、每一个枚举取值都写得进去而不错位', () => {
      // 逐条走一遍全部事件名：任何一个属性名写错都会在这里变成「某一列是空串」。
      for (const name of EVENT_NAMES) {
        const point = dataPointOf(syntheticEvent(name), CONTEXT)
        const blobs = point.blobs ?? []

        expect(blobs).toHaveLength(ANALYTICS_ENGINE_BLOB_SLOTS.length)
        expect(blobs[0]).toBe(name)
      }
    })
  })

  describe('结果', () => {
    it('名字是 analytics-engine——它是日志里唯一用来分辨下游的东西', () => {
      const upstream = createBinding()

      expect(createAnalyticsEngineSink({ dataset: upstream.binding }).name).toBe('analytics-engine')
    })

    it('成功时是 ok，而且没有状态码这一项', async () => {
      const { outcome } = await forwardOne(plainAppStarted())

      // 绑定不回答任何东西，所以「对方回了 400」这种结果在这一版里不存在。
      expect(outcome).toEqual({ ok: true })
    })

    it('写入抛错时是 not_delivered，而不是 unreachable 或 rejected', async () => {
      const upstream = createBinding(true)
      const sink = createAnalyticsEngineSink({ dataset: upstream.binding })

      const outcome = await sink.forward([plainAppStarted()], CONTEXT)

      // 这一版没有网络、没有对方的状态码：能失败的只有「这次调用没把数据点交出去」。
      expect(outcome).toEqual({ ok: false, failure: 'not_delivered' })
    })

    it('不抛异常——异常会在 Cloudflare 那边变成一次 500 与一条栈', async () => {
      const upstream = createBinding(true)
      const sink = createAnalyticsEngineSink({ dataset: upstream.binding })

      await expect(sink.forward([plainAppStarted()], CONTEXT)).resolves.toBeDefined()
    })

    it('空的一批不写任何数据点', async () => {
      const upstream = createBinding()
      const sink = createAnalyticsEngineSink({ dataset: upstream.binding })

      const outcome = await sink.forward([], CONTEXT)

      expect(outcome).toEqual({ ok: true })
      expect(upstream.points).toEqual([])
    })
  })

  describe('数据集', () => {
    it('名字是 SQL 里直接能用的标识符', () => {
      // 连字符会让每一处查询都得写成 `FROM "osw-telemetry"`。
      expect(ANALYTICS_ENGINE_DATASET).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(ANALYTICS_ENGINE_DATASET).toBe('osw_telemetry')
    })
  })
})

/**
 * 一条最普通的 `app_started`，取值不必顶格。
 *
 * 与 `syntheticEvent` 并存是有意的：那一条给「上限」用（每列都顶格），这一条给「正常值」用。
 * 两者混用会让人分不清某条断言验的是形状还是长度。
 */
function plainAppStarted(): TelemetryEvent {
  return {
    name: 'app_started',
    occurredAt: NOW - 1_000,
    installId: INSTALL_ID,
    version: '1.1.0-beta.14',
    os: 'win32',
    arch: 'x64',
    locale: 'en',
    runtime: 'desktop',
  }
}
