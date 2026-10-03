import { useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Network, PlugZap, XCircle } from 'lucide-react'
import type { OutboundProxyMode } from '@common/schemas'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow, FormSelect, type FormOption } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'
import { useOutboundProxyTest } from '../hooks/use-outbound-proxy-test'

interface OutboundProxyCardProps {
  mode: OutboundProxyMode
  proxyUrl: string
  bypass: string
  onModeChange: (value: OutboundProxyMode) => void
  onProxyUrlChange: (value: string) => void
  onBypassChange: (value: string) => void
}

export function OutboundProxyCard(props: OutboundProxyCardProps) {
  const test = useOutboundProxyTest()
  const t = useTranslation()
  const [targetUrl, setTargetUrl] = useState('https://www.gstatic.com/generate_204')

  const modeOptions = useMemo<FormOption[]>(() => [
    { value: 'direct', label: t('settings.outboundProxy.mode.direct') },
    { value: 'system', label: t('settings.outboundProxy.mode.system') },
    { value: 'custom', label: t('settings.outboundProxy.mode.custom') },
  ], [t])

  const modeDescriptions: Record<OutboundProxyMode, string> = {
    direct: t('settings.outboundProxy.mode.directDescription'),
    system: t('settings.outboundProxy.mode.systemDescription'),
    custom: t('settings.outboundProxy.mode.customDescription'),
  }

  return (
    <Card data-screenshot="outbound-proxy">
      <SettingsCardHeader
        icon={<Network />}
        title={t('settings.outboundProxy.title')}
        description={t('settings.outboundProxy.description')}
      />
      <CardContent className="px-4">
        <div className="divide-y divide-border/50">
          <FormRow
            title={t('settings.outboundProxy.mode')}
            description={modeDescriptions[props.mode]}
            control={(
              <FormSelect
                ariaLabel={t('settings.outboundProxy.modeAria')}
                className="w-44"
                options={modeOptions}
                value={props.mode}
                onValueChange={value => props.onModeChange(value as OutboundProxyMode)}
              />
            )}
          />

          {props.mode === 'custom' && (
            <>
              <FormRow
                title={t('settings.outboundProxy.url')}
                description={t('settings.outboundProxy.urlDescription')}
                control={(
                  <Input
                    id="outbound-proxy-url"
                    aria-label={t('settings.outboundProxy.urlAria')}
                    className="w-80 font-mono"
                    value={props.proxyUrl}
                    onChange={event => props.onProxyUrlChange(event.target.value)}
                    placeholder="http://user:password@127.0.0.1:7890"
                  />
                )}
              />
              <FormRow
                title={t('settings.outboundProxy.bypass')}
                description={t('settings.outboundProxy.bypassDescription')}
                control={(
                  <Input
                    id="outbound-proxy-bypass"
                    aria-label={t('settings.outboundProxy.bypassAria')}
                    className="w-80 font-mono"
                    value={props.bypass}
                    onChange={event => props.onBypassChange(event.target.value)}
                    placeholder="localhost,127.0.0.1,::1"
                  />
                )}
              />
            </>
          )}

          <FormRow
            title={t('settings.outboundProxy.test')}
            description={t('settings.outboundProxy.testDescription')}
            control={(
              <>
                <Input
                  aria-label={t('settings.outboundProxy.testTargetAria')}
                  className="w-72 font-mono"
                  value={targetUrl}
                  onChange={event => setTargetUrl(event.target.value)}
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={test.status === 'running' || (props.mode === 'custom' && !props.proxyUrl.trim())}
                  onClick={() => void test.run({ mode: props.mode, proxyUrl: props.proxyUrl, bypass: props.bypass, targetUrl })}
                >
                  {test.status === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                  {test.status === 'running' ? t('settings.outboundProxy.testing') : t('settings.outboundProxy.test')}
                </Button>
              </>
            )}
          />
        </div>

        {test.status === 'success' && test.result && (
          <Alert className="mt-1 mb-1 border-0 bg-success/10 text-text-success">
            <CheckCircle2 />
            <AlertDescription className="text-current">
              {t('settings.outboundProxy.testSuccess', { status: test.result.statusCode, duration: test.result.durationMilliseconds })}
            </AlertDescription>
          </Alert>
        )}
        {test.status === 'error' && (
          <Alert variant="destructive" className="mt-1 mb-1 border-0 bg-destructive/10">
            <XCircle />
            <AlertDescription>{test.errorMessage}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
