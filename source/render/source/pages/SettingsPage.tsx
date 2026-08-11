import { AlertTriangle, FolderOpen, Download, Trash2, RefreshCw, GitBranch, Bug } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground mt-1">配置代理服务和系统参数</p>
      </div>

      <Tabs defaultValue="proxy" className="space-y-6">
        <TabsList className="h-9">
          <TabsTrigger value="proxy" className="h-8 px-4 text-sm">代理设置</TabsTrigger>
          <TabsTrigger value="health" className="h-8 px-4 text-sm">健康检查</TabsTrigger>
          <TabsTrigger value="logs" className="h-8 px-4 text-sm">日志配置</TabsTrigger>
          <TabsTrigger value="about" className="h-8 px-4 text-sm">关于</TabsTrigger>
        </TabsList>

        {/* 代理设置 */}
        <TabsContent value="proxy" className="space-y-6 mt-0">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">监听配置</CardTitle>
                  <CardDescription className="mt-1">本地代理服务的监听地址和端口</CardDescription>
                </div>
                <Badge variant="success" className="gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                  运行中
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="listen-addr">监听地址</Label>
                  <Input id="listen-addr" defaultValue="127.0.0.1" />
                  <p className="text-xs text-muted-foreground">建议使用 127.0.0.1 仅本地访问</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="listen-port">监听端口</Label>
                  <Input id="listen-port" type="number" defaultValue={9300} />
                  <p className="text-xs text-muted-foreground">修改后需要重启服务</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-5 w-9 rounded-full bg-primary relative cursor-pointer">
                  <div className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-sm text-muted-foreground">开机自启动</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">默认超时设置</CardTitle>
              <CardDescription className="mt-1">全局默认超时时间，可在 Provider 级别覆盖</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="conn-timeout">连接超时</Label>
                  <Input id="conn-timeout" type="number" defaultValue={10000} />
                  <p className="text-xs text-muted-foreground">建立连接超时（毫秒）</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="idle-timeout">空闲超时</Label>
                  <Input id="idle-timeout" type="number" defaultValue={30000} />
                  <p className="text-xs text-muted-foreground">服务端无数据返回超时（毫秒）</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="total-timeout">总超时</Label>
                  <Input id="total-timeout" type="number" defaultValue={300000} />
                  <p className="text-xs text-muted-foreground">请求总时长上限（毫秒）</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">上游代理</CardTitle>
              <CardDescription className="mt-1">通过代理访问上游 API（可选）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-5 w-9 rounded-full bg-muted relative cursor-pointer">
                  <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-sm text-muted-foreground">启用上游代理</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-50">
                <div className="space-y-2">
                  <Label>代理地址</Label>
                  <Input placeholder="http://127.0.0.1:7890" disabled />
                </div>
                <div className="space-y-2">
                  <Label>代理类型</Label>
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" disabled>
                    <option>HTTP</option>
                    <option>SOCKS5</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button>保存设置</Button>
          </div>
        </TabsContent>

        {/* 健康检查 */}
        <TabsContent value="health" className="space-y-6 mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">健康检查策略</CardTitle>
              <CardDescription className="mt-1">控制 Provider 故障检测和冷却行为</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fail-threshold">连续失败阈值</Label>
                  <Input id="fail-threshold" type="number" defaultValue={3} />
                  <p className="text-xs text-muted-foreground">达到此次数进入冷却</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="init-cooldown">初始冷却时间</Label>
                  <Input id="init-cooldown" type="number" defaultValue={30} />
                  <p className="text-xs text-muted-foreground">秒</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-cooldown">最大冷却时间</Label>
                  <Input id="max-cooldown" type="number" defaultValue={300} />
                  <p className="text-xs text-muted-foreground">秒，指数退避上限</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-5 w-9 rounded-full bg-primary relative cursor-pointer">
                  <div className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-sm text-muted-foreground">成功一次后重置失败计数</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">主动探测</CardTitle>
              <CardDescription className="mt-1">定期发送探测请求检查 Provider 可用性</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-5 w-9 rounded-full bg-muted relative cursor-pointer">
                  <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-sm text-muted-foreground">启用主动探测</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-50">
                <div className="space-y-2">
                  <Label>探测间隔</Label>
                  <Input type="number" defaultValue={60} disabled />
                  <p className="text-xs text-muted-foreground">秒</p>
                </div>
                <div className="space-y-2">
                  <Label>探测模型</Label>
                  <Input placeholder="使用各绑定的模型" disabled />
                  <p className="text-xs text-muted-foreground">留空使用绑定的模型</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button>保存设置</Button>
          </div>
        </TabsContent>

        {/* 日志配置 */}
        <TabsContent value="logs" className="space-y-6 mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">请求日志</CardTitle>
              <CardDescription className="mt-1">记录所有经过代理的请求</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="h-5 w-9 rounded-full bg-primary relative cursor-pointer">
                  <div className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-sm text-muted-foreground">启用请求日志</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="log-retention">日志保留天数</Label>
                  <Input id="log-retention" type="number" defaultValue={30} />
                  <p className="text-xs text-muted-foreground">超过自动清理</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="log-level">日志级别</Label>
                  <select id="log-level" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option>全部</option>
                    <option>仅失败</option>
                    <option>关闭</option>
                  </select>
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-9 rounded-full bg-muted relative cursor-pointer">
                    <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm" />
                  </div>
                  <span className="text-sm text-muted-foreground">记录请求和响应内容</span>
                </div>
                <p className="text-xs text-warning flex items-center gap-1.5 pl-12">
                  <AlertTriangle size={12} />
                  开启后会存储完整的请求和响应体，可能包含敏感信息
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">数据管理</CardTitle>
              <CardDescription className="mt-1">数据库和日志文件管理</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">数据库大小</Label>
                  <div className="text-sm font-medium">12.4 MB</div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">日志记录数</Label>
                  <div className="text-sm font-medium">28,456 条</div>
                </div>
                <div className="space-y-1.5 sm:col-span-1 col-span-1">
                  <Label className="text-xs text-muted-foreground">数据目录</Label>
                  <div className="text-sm font-mono truncate">~/Library/Application Support/one-switch</div>
                </div>
              </div>
              <Separator />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm">
                  <FolderOpen size={14} /> 打开数据目录
                </Button>
                <Button variant="outline" size="sm">
                  <Download size={14} /> 导出日志
                </Button>
                <Button variant="destructive" size="sm">
                  <Trash2 size={14} /> 清空日志
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button>保存设置</Button>
          </div>
        </TabsContent>

        {/* 关于 */}
        <TabsContent value="about" className="mt-0">
          <Card>
            <CardContent className="py-12 text-center">
              <div className="text-6xl mb-4">🔀</div>
              <h2 className="text-2xl font-bold mb-1">One Switch</h2>
              <p className="text-muted-foreground mb-8">本地大模型代理自动切换工具</p>
              <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground mb-1">版本</div>
                  <div className="font-semibold">v0.1.0</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground mb-1">构建</div>
                  <div className="font-semibold">2024.02.15</div>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" size="sm">
                  <RefreshCw size={14} /> 检查更新
                </Button>
                <Button variant="outline" size="sm">
                  <GitBranch size={14} /> GitHub
                </Button>
                <Button variant="outline" size="sm">
                  <Bug size={14} /> 反馈问题
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-8">
                不做协议转换 · 永远只有一个队列 · 故障自动切换
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
