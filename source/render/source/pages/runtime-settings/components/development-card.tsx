import { Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface DevelopmentCardProps {
  onSeedDevelopment: () => void
}

export function DevelopmentCard(props: DevelopmentCardProps) {
  return (
    <Card className="border-border/70 shadow-none">
      <CardHeader className="border-b border-border/60 px-4 py-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-muted-foreground" />
          开发调试
        </CardTitle>
        <CardDescription>仅在开发环境提供，用于快速准备本地调试数据</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-4 text-muted-foreground">
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
