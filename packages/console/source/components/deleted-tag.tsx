import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'

interface DeletedTagProps {
  className?: string
}

/**
 * 「已删除」标签。
 *
 * 配置里的逻辑模型、供应商、供应商模型都是**软删除**：行留在表里，名字也原样保留。
 * 这样历史请求日志与统计分析里的名字快照才都能对得上一行真实存在过的配置——删掉一条配置，
 * 不该让过去发生过的请求变得无从解释。
 *
 * 但「查得到」和「看得出来」是两件事：历史记录照旧展示那个名字时，读者无从分辨它现在还在不在。
 * 这个标签补的就是这一句话。所以它只在名字**对不上活跃配置**时出现，是纯展示，不拦截任何操作。
 */
export function DeletedTag(props: DeletedTagProps) {
  const t = useTranslation()
  return (
    <Badge variant="muted" className={cn('h-4 shrink-0 px-1.5 system-2xs-medium', props.className)}>
      {t('common.state.deleted')}
    </Badge>
  )
}
