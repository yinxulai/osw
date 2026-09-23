import { useTranslation } from '@/i18n/provider'

/**
 * 彩蛋：小票被一直往下拉（满 50 米）之后，在纸条上「印」出来的一段话。
 *
 * 只负责长什么样；「什么时候出现、怎么被印出来」全在 `paper.tsx` 的 LEADER 里——
 * 靠的是裁切边界，不是自己的显隐。
 * 样式跟着纸条走（等宽承接父级、墨色），不引入任何「界面」的观感。
 */
export function ReceiptEasterEgg() {
  const t = useTranslation()

  return (
    <div className="absolute inset-x-0 text-center text-[#20252f]">
      <div className="border-current border-t border-dashed opacity-40" />
      <p className="mt-3 font-semibold text-sm tracking-[0.16em]">{t('overview.bill.easterEgg.title')}</p>
      <p className="mt-2 text-2xs leading-4 opacity-70">{t('overview.bill.easterEgg.hint')}</p>
      <div className="mt-3 border-current border-t border-dashed opacity-40" />
    </div>
  )
}
