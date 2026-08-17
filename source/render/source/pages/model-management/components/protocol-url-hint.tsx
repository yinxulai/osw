import type { Protocol } from '@common/schemas'
import { PROTOCOL_EXAMPLES } from '../lib/protocols'

interface ProtocolUrlHintProps {
  protocol: Protocol
}

export function ProtocolUrlHint({ protocol }: ProtocolUrlHintProps) {
  const examples = PROTOCOL_EXAMPLES[protocol]
  return (
    <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">
        完整接口地址需包含协议、主机、路径，指向该模型真实的 <span className="font-mono text-[10px]">{protocol}</span> 端点。
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
