import type { ReactNode } from 'react'
import { CardSectionHeader } from '@/components/card-section-header'

interface SettingsCardHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * 卡片头部统一形态：白底 + 一条发丝分隔线，图标是唯一的装饰元素。
 * 放在共享目录里，业务页面（设置、引导……）不再各自拼一遍卡片头。
 */
export function SettingsCardHeader(props: SettingsCardHeaderProps) {
  const { title, description, icon, actions, className } = props
  return (
    <CardSectionHeader
      className={`-mt-4 py-3 ${className ?? ''}`}
      bordered
      title={(
        <span className="flex items-center gap-2">
          {icon && <span className="text-text-quaternary [&>svg]:size-4">{icon}</span>}
          {title}
        </span>
      )}
      description={description}
      actions={actions}
    />
  )
}
