import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface InfoHintProps {
  /**
   * 口径说明：这个数是怎么算出来的、这块数据取自哪一次尝试。
   *
   * 同时也是图标的可访问名——键盘用户与读屏用户不会悬停，得有一条别的路读到同一句话。
   */
  text: string
  className?: string
}

/**
 * 标签右侧那枚「这是怎么算的」小图标，悬停/聚焦才展开一句话。
 *
 * 每个指标、每个分块都有一句口径要交代，但**口径不是数据**：占一行写出来，读者每次扫这张
 * 卡片都得先绕过它，而真正要看的数字被推远。收进图标之后，默认视图只剩标签与数值，
 * 想知道算法的人自己点开。
 *
 * 只在**标签行**里用（指标格的标签、分块的标题）。正文里不要放——那里的每个字都是数据。
 */
export function InfoHint(props: InfoHintProps) {
  return (
    <Tooltip>
      {/* 图标是 16px 的方框、与这一行行高同高，加进来不会把标签行撞高；
          它不是内容，用最浅的一档，浮入才变深。 */}
      <TooltipTrigger
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-text-quaternary outline-none transition-colors hover:text-text-secondary focus-visible:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          props.className,
        )}
        aria-label={props.text}
      >
        <Info size={12} aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{props.text}</TooltipContent>
    </Tooltip>
  )
}
