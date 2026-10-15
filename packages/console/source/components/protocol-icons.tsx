import { BotMessageSquare, MessageSquareCode, Repeat, Sparkles } from 'lucide-react'
import type { Protocol, ProviderModelRouteEndpoint } from '@common/schemas'
import { CONVERTIBLE_PROTOCOLS, PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/i18n/provider'

/**
 * 图标只负责形状，名字统一取自契约层的 `PROTOCOL_DISPLAY_NAMES`。
 *
 * 导出是因为**同一个协议在哪儿都得长得一样**：模型详情的协议徽章、模型对话框的
 * 协议选择、诊断结果表的协议色条，三处各画一套迟早会出现「这里是 ○ 那里是 □」。
 */
export const PROTOCOL_ICONS: Record<Protocol, typeof MessageSquareCode> = {
  'openai-completions': MessageSquareCode,
  'openai-responses': Sparkles,
  'anthropic-messages': BotMessageSquare,
}

interface ProtocolIconsProps {
  endpoints: ProviderModelRouteEndpoint[]
}

export function ProtocolIcons(props: ProtocolIconsProps) {
  const { endpoints } = props
  const t = useTranslation()

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex shrink-0 items-center gap-0.5">
        {endpoints.map(endpoint => {
          const label = PROTOCOL_DISPLAY_NAMES[endpoint.protocol]
          const ProtocolIcon = PROTOCOL_ICONS[endpoint.protocol]
          return (
            <Tooltip key={endpoint.protocol}>
              <TooltipTrigger asChild>
                <span className="inline-flex size-5 items-center justify-center rounded-md bg-inset text-text-tertiary" aria-label={label}>
                  <ProtocolIcon size={11} aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          )
        })}
        {endpoints
          .filter(endpoint => endpoint.protocolConversionEnabled)
          .flatMap(endpoint => CONVERTIBLE_PROTOCOLS[endpoint.protocol]
            .filter(from => !endpoints.some(native => native.protocol === from))
            .map(from => {
              const label = PROTOCOL_DISPLAY_NAMES[from]
              const ProtocolIcon = PROTOCOL_ICONS[from]
              return (
                <Tooltip key={`conv-${endpoint.protocol}-${from}`}>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex size-5 items-center justify-center rounded-md bg-warning/10 text-text-warning"
                      aria-label={t('protocol.conversion.aria', { protocol: label })}
                    >
                      <ProtocolIcon size={9} aria-hidden className="m-0.5" />
                      <Repeat size={7} aria-hidden className="-ml-1.5 -mb-1.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('protocol.conversion.tooltip', { protocol: label, target: PROTOCOL_DISPLAY_NAMES[endpoint.protocol] })}</TooltipContent>
                </Tooltip>
              )
            }))}
      </div>
    </TooltipProvider>
  )
}
