import type { ReactNode } from 'react'
import { CardSectionHeader } from '@/components/card-section-header'

interface SettingsCardHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

export function SettingsCardHeader(props: SettingsCardHeaderProps) {
  return <CardSectionHeader {...props} bordered className={props.className} />
}
