import { Pause, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ProxyToggleButtonProps {
  running: boolean
  onToggle: () => void | Promise<void>
}

export function ProxyToggleButton(props: ProxyToggleButtonProps) {
  const { running, onToggle } = props

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'group h-8 gap-2 rounded-md px-2.5 text-xs font-medium transition-colors',
        running
          ? 'bg-success/10 text-success hover:bg-destructive/10 hover:text-destructive'
          : 'bg-primary/10 text-primary hover:bg-primary/15',
      )}
      aria-label={running ? '暂停服务' : '启动服务'}
      title={running ? '暂停本地代理服务' : '启动本地代理服务'}
      onClick={() => void onToggle()}
    >
      <span className="relative flex size-2 items-center justify-center">
        <span className={cn(
          'size-2 rounded-full',
          running ? 'bg-success' : 'bg-primary',
        )} />
        {running && <span className="absolute size-3 rounded-full bg-success/30 motion-safe:animate-ping motion-reduce:animate-none" />}
      </span>
      <span>{running ? '运行中' : '已停止'}</span>
      <span className={cn(
        'ml-0.5 flex size-5 items-center justify-center rounded-sm transition-colors',
        running
          ? 'text-success/70 group-hover:bg-destructive/10 group-hover:text-destructive'
          : 'text-primary/70 group-hover:bg-primary/10 group-hover:text-primary',
      )}>
        {running ? <Pause size={11} className="fill-current" /> : <Power size={12} />}
      </span>
    </Button>
  )
}
