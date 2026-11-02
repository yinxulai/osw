import { ShieldCheck } from 'lucide-react'
import { useTranslation } from '@/i18n/provider'

/** 页面顶部的常驻说明：全局规则与普通规则的生效方式不同。 */
export function RulesNotice() {
  const t = useTranslation()

  return (
    <div className="flex items-start gap-2 rounded-lg border border-info/20 bg-info/8 px-3 py-2 system-xs-regular text-text-tertiary">
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
      <span className="min-w-0">{t('rules.notice')}</span>
    </div>
  )
}
