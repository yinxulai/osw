import { useCallback, useMemo, useState, type MutableRefObject } from 'react'
import { routerRulesApi } from '@/api/router-rules'
import { unwrap } from '@/api/unwrap'
import { useTranslation } from '@/i18n/provider'
import type { RouteRuleRunResult } from '@common/router/route-rule-engine'
import type { RouteRuleSet } from '@common/router/route-rules'
import type { RuntimeLogicalModel } from '@common/router/types'
import { initialPayloadText, parseRunPayload, payloadRowsFor } from '../run-payload'

/**
 * 试跑抽屉这一块：输入负载、发起试跑、拿结果。
 *
 * 试的是**列表上此刻这一份**规则表（不必先保存），所以读的是 `ruleSetRef.current`；匹配判定
 * 全走服务端引擎，这里只负责把文本解析成负载、把结果接回界面。切换内容（套预设 / 载入版本）时
 * 由上层调 `clearResult()` 把上一次的结果清掉。
 */
export function useRuleTestRun(ruleSetRef: MutableRefObject<RouteRuleSet>, runtimeLogicalModels: readonly RuntimeLogicalModel[]) {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const [payloadText, setPayloadText] = useState(initialPayloadText)
  const [payloadError, setPayloadError] = useState('')
  const [result, setResult] = useState<RouteRuleRunResult | null>(null)
  const rows = useMemo(() => payloadRowsFor(payloadText), [payloadText])

  const clearResult = useCallback(() => setResult(null), [])

  const run = useCallback(async () => {
    let payload: Record<string, unknown>
    try {
      payload = parseRunPayload(payloadText, runtimeLogicalModels)
    } catch {
      setResult(null)
      setPayloadError(t('router.error.invalidPayload'))
      return
    }

    try {
      setPayloadError('')
      setResult(await unwrap(routerRulesApi.run(ruleSetRef.current, payload)))
    } catch (error) {
      setResult(null)
      setPayloadError(error instanceof Error ? error.message : String(error))
    }
  }, [payloadText, runtimeLogicalModels, ruleSetRef, t])

  return { open, setOpen, payloadText, setPayloadText, rows, payloadError, result, run, clearResult }
}
