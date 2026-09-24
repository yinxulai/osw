import { useNavigate } from '@tanstack/react-router'
import { routePaths } from '@/routing/routes'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'

interface ServiceStatusBarProps {
  running: boolean
  host: string
  port: number | null
  /** 监听在 0.0.0.0 / :: 上时，回环地址才是本机客户端该用的地址。 */
  wildcardHost: boolean
}

/**
 * 服务状态带：这一步的前提，不是这一步的内容。
 *
 * 它不带上序号、也不是一张卡：下面两张卡讲的是「要填什么」，这条带子讲的是「成不成立」——
 * 两条并列的卡片会让这个区别立刻读不出来，而这一步最该先知道的就是服务在不在跑。
 *
 * 里面只有一件需要用户动手的事（换监听地址），所以它压成一条带子：
 * 在跑吗 / 监听在哪 / 谁连得上 / 换地址，四句话就够。启停不在这里——那件事属于
 * 「服务本身」而不是「往客户端里填什么」，入口留在逻辑模型页页头与托盘菜单里。
 */
export function ServiceStatusBar(props: ServiceStatusBarProps) {
  const { running, host, port, wildcardHost } = props
  const navigate = useNavigate()
  const t = useTranslation()
  // 服务没起来（或刚从旧配置切过来）时端口还没读到，这一格就摆「正在读取」而不是空着。
  const listening = host && port !== null ? t('access.service.listening', { host, port }) : null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-module-border bg-card px-4 py-2.5">
      {/* 状态点常驻（颜色之外还有一个字），运行中才带呼吸动画。 */}
      <span
        className={cn(
          'flex items-center gap-1.5 system-sm-medium',
          running ? 'text-text-primary' : 'text-text-destructive',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            running ? 'bg-success-foreground motion-safe:animate-pulse' : 'bg-text-quaternary',
          )}
        />
        {running ? t('access.service.running') : t('access.service.stopped')}
      </span>

      {/* 监听地址是原样的绑定地址（通配监听时就是 0.0.0.0），客户端该用的那一条在下面那张卡的地址一栏。 */}
      <span className={cn('system-xs-regular', listening ? 'font-mono text-text-secondary' : 'text-text-tertiary')}>
        {listening ?? t('access.service.reading')}
      </span>

      <span className="min-w-0 system-xs-regular text-text-tertiary">
        {wildcardHost ? t('access.service.reachAll') : t('access.service.reachLocal')}
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto shrink-0"
        onClick={() => void navigate({ to: routePaths.runtimeSettings })}
      >
        {t('access.service.changeHost')}
      </Button>
    </div>
  )
}
