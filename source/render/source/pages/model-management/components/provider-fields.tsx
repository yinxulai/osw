import { KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ProviderFieldsProps {
  editingProviderId: string | null
  providerName: string
  apiKey: string
  timeout: string
  setProviderName: (name: string) => void
  setApiKey: (key: string) => void
  setTimeout: (timeout: string) => void
}

export function ProviderFields(props: ProviderFieldsProps) {
  const { editingProviderId, providerName, apiKey, timeout, setProviderName, setApiKey, setTimeout } = props

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="provider-name">供应商名称</Label>
          <Input
            id="provider-name"
            value={providerName}
            onChange={event => setProviderName(event.target.value)}
            placeholder="例如：OpenAI / DeepSeek"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="provider-key">API Key（可选）</Label>
          <div className="relative">
            <KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="provider-key"
              type="password"
              className="pl-8"
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              placeholder={editingProviderId ? '留空表示不修改' : '可选，例如 sk-...'}
            />
          </div>
          <p className="text-xs text-muted-foreground">仅保存在本机；无需鉴权的上游可以留空。</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="provider-timeout">请求超时（毫秒）</Label>
          <Input
            id="provider-timeout"
            type="number"
            min={1}
            value={timeout}
            onChange={event => setTimeout(event.target.value)}
            placeholder="例如：30000"
          />
          <p className="text-[11px] text-muted-foreground">
            超时后自动切换下一个候选模型，默认 30 秒（30000 毫秒）。
          </p>
        </div>
      </div>
    </div>
  )
}
