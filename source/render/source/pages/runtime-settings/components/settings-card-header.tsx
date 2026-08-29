import type { ReactNode } from 'react'
import { CardSectionHeader } from '@/components/card-section-header'

interface SettingsCardHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

export function SettingsCardHeader(props: SettingsCardHeaderProps) {
  const { title, description, icon, actions, className } = props
  return (
    <CardSectionHeader
      bordered
      className={className}
      title={(
        <span className="flex items-center gap-2">
          {icon && <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>}
          {title}
        </span>
      )}
      description={description}
      actions={actions}
    />
  )
}
