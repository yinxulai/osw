import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ThemeMode } from '@/components/app-sidebar'

interface GeneralCardProps {
  autoLaunch: boolean
  onAutoLaunchChange: (enabled: boolean) => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}

export function GeneralCard(props: GeneralCardProps) {
  const { autoLaunch, onAutoLaunchChange, themeMode, onThemeModeChange } = props

  return (
    <Card className="border-border">
      <CardHeader className="border-b border-border/60 px-4 py-4">
        <CardTitle>通用</CardTitle>
        <CardDescription>应用行为相关设置</CardDescription>
      </CardHeader>
      <CardContent className="px-4 py-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="space-y-0.5">
              <Label htmlFor="theme-mode" className="text-sm">主题</Label>
              <p className="text-xs text-muted-foreground">选择应用的颜色主题</p>
            </div>
            <Select value={themeMode} onValueChange={value => onThemeModeChange(value as ThemeMode)}>
              <SelectTrigger id="theme-mode" className="w-36" aria-label="主题模式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">跟随系统</SelectItem>
                <SelectItem value="light">亮色</SelectItem>
                <SelectItem value="dark">暗色</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="space-y-0.5">
              <Label htmlFor="auto-launch" className="text-sm">开机自启</Label>
              <p className="text-xs text-muted-foreground">登录系统时自动启动并隐藏到托盘</p>
            </div>
            <Switch
              id="auto-launch"
              checked={autoLaunch}
              onCheckedChange={onAutoLaunchChange}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
