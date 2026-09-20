import { useTranslation } from 'react-i18next'
import { FeatureIcon, type FeatureId } from '../feature-icons'
import { Reveal } from './reveal'
import { SectionHeading } from './section-heading'

/**
 * 能力清单。
 *
 * 旧版是「两张大卡 + 四张小卡」的纯尺寸分级，但两张大卡之间没有关系、
 * 四张小卡也没有共同主题，读起来像六个互不相干的卖点。
 * 这里改成「1 个骨架 + 3 组能力」：左边一张竖长卡讲路由与改写（都发生在
 * 请求进入之后、发出之前），右边两张横卡讲可观测与协议覆盖，边界更清楚。
 */
interface Point {
  key: string
  text: string
}

interface Capability {
  id: FeatureId
  key: string
  title: string
  body: string
  /** 卡片下方的具体能力点，避免正文写成一大段形容词。 */
  points: Point[]
}

const ROUTING: Capability = {
  id: 'routing',
  key: 'capabilities.routing',
  title: '路由与改写',
  body: '请求进入网关之后、发往上游之前，你可以决定它去哪、以及长什么样。',
  points: [
    {
      key: 'capabilities.routing.p1',
      text: '节点图画分流：按模型、按客户端、按请求头任意组合条件',
    },
    {
      key: 'capabilities.routing.p2',
      text: '规则表模式给习惯写配置的人用，两种模式随时互切',
    },
    {
      key: 'capabilities.routing.p3',
      text: '每次保存生成一个版本，出问题一键回滚',
    },
    {
      key: 'capabilities.routing.p4',
      text: '重写规则改 Header、改 JSON 字段、替换文本，都不需要写代码',
    },
  ],
}

const OBSERVABILITY: Capability = {
  id: 'logs',
  key: 'capabilities.observability',
  title: '每一次尝试都留痕',
  body: '「哪个渠道真的服务了这次请求」在别处通常只能猜。',
  points: [
    { key: 'capabilities.observability.p1', text: '实际命中的供应商与模型' },
    { key: 'capabilities.observability.p2', text: '第几次尝试才成功' },
    { key: 'capabilities.observability.p3', text: '总耗时、首字延迟、每秒 token' },
  ],
}

const PROTOCOL: Capability = {
  id: 'gateway',
  key: 'capabilities.protocol',
  title: '协议自动识别',
  body: '同一端口同时接受 Responses、Completions 与 Messages，按请求体自己判断，客户端不用改配置。',
  points: [
    { key: 'capabilities.protocol.p1', text: 'OpenAI Responses API' },
    { key: 'capabilities.protocol.p2', text: 'OpenAI Chat Completions' },
    { key: 'capabilities.protocol.p3', text: 'Anthropic Messages' },
  ],
}

export function CapabilitiesSection() {
  const { t } = useTranslation()

  return (
    <section id="capabilities" className="scroll-mt-24 py-16 sm:py-20">
      <SectionHeading
        eyebrow={t('capabilities.eyebrow', '能力')}
        title={t('capabilities.title', '网关之上，还有一层可配置的中间件')}
        lead={t(
          'capabilities.lead',
          '透传是默认行为，但真实项目里总有需要动一下的地方：某个客户端要用不同的渠道、某个上游的字段名不一致、某次请求慢到需要查清楚。',
        )}
      />

      <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Reveal>
          <CapabilityCard feature={ROUTING} emphasis />
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Reveal delay={80}>
            <CapabilityCard feature={OBSERVABILITY} />
          </Reveal>
          <Reveal delay={160}>
            <CapabilityCard feature={PROTOCOL} />
          </Reveal>
        </div>
      </div>

      {/* 剩下两条（故障转移 / 本地）已经各自有独立区块，这里只留一行指引。 */}
      <Reveal delay={200}>
        <p className="mt-4 text-[12px] text-ink-4">
          {t(
            'capabilities.more',
            '故障转移的判定口径见上一节；数据不出本机的说明见下一节。',
          )}
        </p>
      </Reveal>
    </section>
  )
}

interface CapabilityCardProps {
  feature: Capability
  /** 主卡：图标底座更大、正文更长，用来撑起左栏的高度。 */
  emphasis?: boolean
}

function CapabilityCard(params: CapabilityCardProps) {
  const { feature, emphasis = false } = params
  const { t } = useTranslation()

  return (
    <article
      className={`ring-gradient group h-full rounded-2xl bg-surface-0/60 p-6 transition-colors hover:bg-surface-1/60 ${emphasis ? 'sm:p-7' : ''
        }`}
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-2 transition-colors group-hover:border-brand/35 group-hover:text-brand">
        <FeatureIcon id={feature.id} className="h-5 w-5" />
      </span>

      <h3
        className={`mt-5 font-semibold tracking-tight text-ink ${emphasis ? 'text-lg' : 'text-base'
          }`}
      >
        {t(`${feature.key}.title`, feature.title)}
      </h3>
      <p className="mt-2.5 text-pretty text-[13px] leading-relaxed text-ink-3">
        {t(`${feature.key}.body`, feature.body)}
      </p>

      <ul className="mt-5 space-y-2 border-t border-line pt-5">
        {feature.points.map((point) => (
          <li
            key={point.key}
            className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-3"
          >
            <span
              aria-hidden="true"
              className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-ink-4"
            />
            <span className="text-pretty">{t(point.key, point.text)}</span>
          </li>
        ))}
      </ul>
    </article>
  )
}
