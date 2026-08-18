import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface GeneralCardProps {
  autoLaunch: boolean
  onAutoLaunchChange: (enabled: boolean) => void
}

export function GeneralCard(props: GeneralCardProps) {
  const { autoLaunch, onAutoLaunchChange } = props

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>通用</CardTitle>
        <CardDescription>应用行为相关设置</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between py-1">
          <div className="space-y-0.5">
            <Label htmlFor="auto-launch" className="text-xs">开机自启</Label>
            <p className="text-[11px] text-muted-foreground">登录系统时自动启动并隐藏到托盘</p>
          </div>
          <Switch
            id="auto-launch"
            checked={autoLaunch}
            onCheckedChange={onAutoLaunchChange}
          />
        </div>
      </CardContent>
    </Card>
  )
}
