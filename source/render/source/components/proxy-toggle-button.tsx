import { Pause } from 'lucide-react'
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button'

interface ProxyToggleButtonProps {
  running: boolean
  onToggle: () => void | Promise<void>
}

export function ProxyToggleButton(props: ProxyToggleButtonProps) {
  const { running, onToggle } = props

  return (
    <InteractiveHoverButton
      hoverContent={running ? (
        <>
          <span>暂停服务</span>
          <Pause className="size-3 fill-current" />
        </>
      ) : undefined}
      aria-label={running ? '暂停服务' : '启动服务'}
      title={running ? '暂停本地代理服务' : '启动本地代理服务'}
      onClick={() => void onToggle()}
    >
      {running ? '运行中' : '启动服务'}
    </InteractiveHoverButton>
  )
}
