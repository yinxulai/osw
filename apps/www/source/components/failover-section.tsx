import { useTranslation } from 'react-i18next'
import { Reveal } from './reveal'
import { SectionHeading } from './section-heading'

/**
 * 故障转移规则表。
 *
 * 这是全站唯一一处「把判定条件逐条摊开」的地方，也是最有说服力的一节：
 * 用户真正想知道的是「什么情况下会换、什么情况下不换」，而不是「支持故障转移」。
 * 表格是英文 README 里已经在用的口径，这里保持一字不改，避免两处说法漂移。
 */
type Verdict = 'switch' | 'pass' | 'abort'

interface Rule {
  id: string
  trigger: string
  verdict: Verdict
  note: string
}

const RULES: Rule[] = [
  {
    id: 'network',
    trigger: '网络错误 / 连接超时 / 流式空闲超时',
    verdict: 'switch',
    note: '换下一个渠道',
  },
  {
    id: 'auth',
    trigger: '401 / 403',
    verdict: 'switch',
    note: '换下一个渠道，并累计该供应商的失败状态',
  },
  {
    id: 'pressure',
    trigger: '408 / 429',
    verdict: 'switch',
    note: '换下一个渠道',
  },
  {
    id: 'server',
    trigger: '5xx',
    verdict: 'switch',
    note: '换下一个渠道',
  },
  {
    id: 'client',
    trigger: '其他 4xx（例如参数写错）',
    verdict: 'pass',
    note: '直接返回给你 —— 换渠道也救不了',
  },
  {
    id: 'stream',
    trigger: '已开始传输响应后断开',
    verdict: 'abort',
    note: '终止这次请求，不拼接另一个渠道的输出',
  },
]

/** 判定结果对应的视觉：换道用品牌色、直通用中性色、终止用暖色。 */
const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  switch: {
    label: '换下一个',
    className: 'border-mint/30 bg-mint/10 text-mint',
  },
  pass: {
    label: '原样返回',
    className: 'border-line-strong bg-white/4 text-ink-3',
  },
  abort: {
    label: '终止请求',
    className: 'border-sand/30 bg-sand/10 text-sand',
  },
}

export function FailoverSection() {
  const { t } = useTranslation()

  return (
    <section id="failover" className="scroll-mt-24 py-16 sm:py-20">
      <SectionHeading
        eyebrow={t('failover.eyebrow', '故障转移')}
        title={t('failover.title', '渠道会挂，是预期内的事')}
        lead={t(
          'failover.lead',
          '网络抖动、限流、额度耗尽、密钥失效、上游 5xx —— 这些都不该由你来处理。下面是完整的判定口径，没有藏着「部分情况需要手动切换」之类的例外。',
        )}
      />

      <Reveal delay={80}>
        <div className="ring-gradient mt-10 overflow-hidden rounded-2xl bg-surface-0/60">
          {/* 表头只在大屏出现：窄屏上每行已经自带标签，再顶一行表头是重复。 */}
          <div className="hidden grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)] gap-6 border-b border-line px-6 py-3 text-[11px] font-medium tracking-[0.14em] text-ink-4 uppercase sm:grid">
            <span>{t('failover.colTrigger', '上游发生了什么')}</span>
            <span>{t('failover.colVerdict', 'OSW 怎么做')}</span>
            <span>{t('failover.colNote', '说明')}</span>
          </div>

          <ul>
            {RULES.map((rule) => {
              const style = VERDICT_STYLE[rule.verdict]
              return (
                <li
                  key={rule.id}
                  className="grid gap-x-6 gap-y-2 border-b border-line px-6 py-4 transition-colors last:border-b-0 hover:bg-white/2.5 sm:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)] sm:items-center"
                >
                  <code className="font-mono text-[13px] text-ink-2">
                    {t(`failover.rule.${rule.id}.trigger`, rule.trigger)}
                  </code>
                  <span
                    className={`justify-self-start rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${style.className}`}
                  >
                    {t(`failover.verdict.${rule.verdict}`, style.label)}
                  </span>
                  <span className="text-[13px] leading-relaxed text-ink-3">
                    {t(`failover.rule.${rule.id}.note`, rule.note)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </Reveal>

      <Reveal delay={140}>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-4">
          {t(
            'failover.tuning',
            '默认连续失败 3 次进入冷却、首轮冷却 30 秒（每次失败递增，最长 5 分钟）、流式响应 30 秒没有新数据算超时 —— 三个数字都在「设置 → 可靠性 → 故障转移」里可调。',
          )}
        </p>
      </Reveal>
    </section>
  )
}
