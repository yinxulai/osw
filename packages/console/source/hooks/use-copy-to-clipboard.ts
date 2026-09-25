import { useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

const FEEDBACK_DURATION = 1500

/**
 * 复制到剪贴板，并用 key 记录当前处于「已复制」状态的按钮，
 * 让同一页面上多个复制入口各自独立反馈，不会互相点亮。
 *
 * 与 `CopyButton` 一起放在共用位置：地址这一组值出现在引导页与客户端配置页两处，
 * 回执时长、失败提示都得是同一套。
 */
export function useCopyToClipboard() {
  const toast = useToast()
  const t = useTranslation()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const copy = async (key: string, value: string): Promise<void> => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopiedKey(null), FEEDBACK_DURATION)
      toast.success(t('common.toast.copied'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.action.copyFailed'))
    }
  }

  return { copiedKey, copy }
}
