import { Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from './settings-card-header'

interface DevelopmentCardProps {
  onSeedDevelopment: () => void
}

export function DevelopmentCard(props: DevelopmentCardProps) {
  return (
    <Card>
      <SettingsCardHeader icon={<Database />} title="开发调试" description="仅在开发环境提供" />
      <CardContent className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">
          添加示例供应商、逻辑模型、供应商模型和请求记录，不会覆盖已有配置。
        </p>
        <Button variant="secondary" className="shrink-0" onClick={props.onSeedDevelopment}>
          <Database className="mr-1 h-3.5 w-3.5" />
          插入测试数据
        </Button>
      </CardContent>
    </Card>
  )
}
