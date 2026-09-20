import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 首页主视觉：一次真实的故障转移轨迹。
 *
 * 之所以不做「客户端截图 + 光晕」那种通用 hero 图：本产品最难用一句话讲清的
 * 恰恰是「失败之后发生了什么」，而这件事正好可以画成一条有先后顺序的链。
 * 这里用三段式——客户端发出 → 上游拒绝 → 自动改道成功——把产品承诺直接演示出来。
 *
 * 状态机每 4.2 秒循环一次，中途在 `rejected` 处停留（那是全篇的信息点）。
 * `prefers-reduced-motion` 下停在「成功」那一帧，不循环。
 */
type Phase = 'idle' | 'rejected' | 'recovered'

const PHASE_ORDER: Phase[] = ['idle', 'rejected', 'recovered']
/** 每一段停留时长（毫秒），下标与 `PHASE_ORDER` 对齐。 */
const PHASE_HOLD = [1500, 1500, 1800]

export function RequestTrace() {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('recovered')
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setAuto(!query.matches)
    const listener = (event: MediaQueryListEvent) => setAuto(!event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  useEffect(() => {
    if (!auto) return
    const index = PHASE_ORDER.indexOf(phase)
    const timer = window.setTimeout(
      () => setPhase(PHASE_ORDER[(index + 1) % PHASE_ORDER.length]),
      PHASE_HOLD[index],
    )
    return () => window.clearTimeout(timer)
  }, [phase, auto])

  const rejected = phase !== 'idle'
  const recovered = phase === 'recovered'

  return (
    <div className="ring-gradient overflow-hidden rounded-2xl bg-surface-0/80 backdrop-blur">
      {/* 窗口头：用产品里那套「标题 + 说明」的写法，而不是三个假的红绿灯圆点。 */}
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" />
          </span>
          <span className="truncate text-[13px] font-medium text-ink-2">
            {t('trace.title', '一次请求的真实轨迹')}
          </span>
        </div>
        <code className="shrink-0 font-mono text-[11px] text-ink-4">
          POST /v1/responses
        </code>
      </div>

      <div className="space-y-2.5 p-5">
        {/* 第一跳：客户端 → 本地网关。这一段永远成功，用中性色。 */}
        <TraceRow
          tone="neutral"
          label={t('trace.hop1', '客户端 → 本地网关')}
          detail="127.0.0.1:9300"
          badge={t('trace.hop1Badge', '已识别')}
        />

        {/* 第二跳：首个渠道拒绝。这是全篇重点，用暖色并保留在画面上。 */}
        <TraceRow
          active={rejected}
          tone="rose"
          label={t('trace.hop2', '渠道 A · 火山引擎')}
          detail={t('trace.hop2Detail', '429 · 该渠道限流')}
          badge={rejected ? t('trace.hop2Badge', '自动改道') : undefined}
        />

        {/* 第三跳：下一个渠道接手。`recovered` 之前保持半透明，表示尚未发生。 */}
        <TraceRow
          active={recovered}
          dim={!recovered}
          tone="mint"
          label={t('trace.hop3', '渠道 B · OpenAI')}
          detail={
            recovered ? t('trace.hop3Detail', '200 · 653ms · 首字 0.14s') : '—'
          }
          badge={recovered ? t('trace.hop3Badge', '已完成') : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-5 py-3">
        <span className="text-[11px] text-ink-4">
          {t('trace.footnote', '客户端只看到成功的那一次')}
        </span>
        <span className="font-mono text-[11px] text-ink-4">
          {t('trace.attempts', '尝试 2 次 · 拼接 0 次')}
        </span>
      </div>
    </div>
  )
}

interface TraceRowProps {
  label: string
  detail: string
  badge?: string
  tone: 'neutral' | 'rose' | 'mint'
  active?: boolean
  dim?: boolean
}

/** 轨迹里的一行。左边一枚状态点，中间标签，右边结果。 */
function TraceRow(params: TraceRowProps) {
  const { label, detail, badge, tone, active = true, dim = false } = params

  const dot = {
    neutral: 'bg-ink-4',
    rose: 'bg-rose',
    mint: 'bg-mint',
  }[tone]

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-line px-3.5 py-2.5 transition-all duration-500 ${dim ? 'opacity-35' : 'opacity-100'
        } ${active && !dim ? 'bg-surface-2/70' : 'bg-surface-1/40'}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-500 ${active && !dim ? dot : 'bg-ink-4'
          }`}
      />
      <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">{label}</span>
      <span className="shrink-0 font-mono text-[11px] text-ink-3">{detail}</span>
      {badge ? (
        <span
          className={`hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium sm:inline-block ${tone === 'mint'
              ? 'border-mint/30 bg-mint/10 text-mint'
              : tone === 'rose'
                ? 'border-rose/30 bg-rose/10 text-rose'
                : 'border-line-strong text-ink-3'
            }`}
        >
          {badge}
        </span>
      ) : null}
    </div>
  )
}
