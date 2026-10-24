import { cn } from '@/lib/utils'

/**
 * 卡片里的一枚**紧凑指标格**：只有两行，标签 + 数值。
 *
 * 它与 `metric-grid.tsx` 的 `MetricGrid` 不是同一种东西，两者也不该合并：
 * `MetricGrid` 是页面顶部的**总览卡**，一格占一张卡、数值用 `system-xl-semibold`，
 * 读法是「先扫四张大数字」；这里的格子是**详情卡内部的嵌套模块**，数值只有
 * `system-md-medium`、标签是小号大写，读法是「在一张卡里并排比对一串读数」。
 * 把总览卡的尺寸搬进详情，展开区会立刻比它所属的那一行更重。
 *
 * 只有两行，不加第三行补充说明：「缓存是否命中」这类上下文在各自的原始数据里
 * 都已有落点，在数值底下再写一遍只会稀释数字本身。空值走最淡的一档灰，
 * 让有数字的格子自己浮出来。
 */
export interface MetricCardProps {
  label: string
  value: string
  /**
   * 数值的语义色，只在「这个数的好坏本身就是结论」时用（例如成功率没到 100%）。
   *
   * 大部分指标不带色调：一排五颜六色的读数里，真正需要被注意的那格反而浮不出来。
   * 空值一律走最淡的灰，**穿不过**这里的色调——`—` 不是「坏」，是「没测到」。
   */
  tone?: 'default' | 'success' | 'destructive'
}

const TONE_CLASS_NAMES: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'text-text-primary',
  success: 'text-text-success',
  destructive: 'text-text-destructive',
}

export function MetricCard(props: MetricCardProps) {
  const empty = props.value === '—'

  return (
    <div data-slot="metric-card" className="rounded-lg border border-module-border px-3 py-2.5">
      <div className="system-2xs-medium-uppercase tracking-wider text-text-tertiary">{props.label}</div>
      <div
        className={cn(
          'mt-1 truncate font-mono system-md-medium tabular-nums',
          empty ? 'text-text-quaternary' : TONE_CLASS_NAMES[props.tone ?? 'default'],
        )}
      >
        {props.value}
      </div>
    </div>
  )
}

/**
 * 装一排指标格的网格。
 *
 * `auto-fill`（而非 `auto-fit`）：只有一两个指标有值时也让格子保持统一宽度，
 * 不被拉满整行——拉满之后「这里少了一格」这件事反而看不出来了。
 *
 * 这套「自带一圈框、各自成块」的读法是**详情区**的通用读法：请求详情与渠道诊断
 * 的明细都用它。诊断明细曾经单独造过一套（一排无缝读数、只靠列间竖线分界），
 * 试了四版都被判为更难看——问题不在细节，而在于同一屏里已经有一份验证过的答案时
 * 又去发明第二种。往后新增详情类读数组，直接复用这里，别再另立一套。
 */
export const METRIC_CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2'
