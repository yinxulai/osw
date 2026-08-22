import type { Protocol } from '@common/schemas'
import { PROTOCOL_EXAMPLES } from '../lib/protocols'

interface ProtocolUrlHintProps {
  protocol: Protocol
}

export function ProtocolUrlHint(props: ProtocolUrlHintProps) {
  const { protocol } = props
  const examples = PROTOCOL_EXAMPLES[protocol]
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        完整接口地址需包含协议、主机、路径，指向该模型真实的 <span className="font-mono text-[11px]">{protocol}</span> 端点。
      </p>
      <div className="mt-1.5 space-y-0.5">
        {examples.map(example => (
          <div key={example.url} className="flex items-center gap-1.5 text-[10px]">
            <span className="shrink-0 text-muted-foreground">{example.provider}：</span>
            <code className="truncate text-muted-foreground/80">{example.url}</code>
          </div>
        ))}
      </div>
    </div>
  )
}
