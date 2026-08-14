import { AlertTriangle, FolderOpen, Download, Trash2, RefreshCw, GitBranch, Bug } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'

export default function SettingsPage() {
  return (
    <PageLayout>
      <PageHeader title="设置" description="配置代理服务和系统参数" />
      <PageContent>

      <Tabs defaultValue="proxy" className="space-y-4">
        <TabsList className="h-8">
          <TabsTrigger value="proxy" className="h-7 px-3 text-xs">代理设置</TabsTrigger>
          <TabsTrigger value="health" className="h-7 px-3 text-xs">健康检查</TabsTrigger>
          <TabsTrigger value="logs" className="h-7 px-3 text-xs">日志配置</TabsTrigger>
          <TabsTrigger value="about" className="h-7 px-3 text-xs">关于</TabsTrigger>
        </TabsList>

        {/* 代理设置 */}
        <TabsContent value="proxy" className="space-y-4 mt-0">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>监听配置</CardTitle>
                  <CardDescription className="mt-0.5">本地代理服务的监听地址和端口</CardDescription>
                </div>
                <Badge variant="success" className="gap-1 h-5 px-1.5 text-[11px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                  运行中
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="listen-addr" className="text-xs">监听地址</Label>
                  <Input id="listen-addr" defaultValue="127.0.0.1" className="h-8 text-xs" placeholder="例如：127.0.0.1" />
                  <p className="text-[11px] text-muted-foreground">建议使用 127.0.0.1 仅本地访问</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="listen-port" className="text-xs">监听端口</Label>
                  <Input id="listen-port" type="number" defaultValue={9300} className="h-8 text-xs" placeholder="例如：9300" />
                  <p className="text-[11px] text-muted-foreground">修改后需要重启服务</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-7 rounded-full bg-primary relative cursor-pointer shrink-0">
                  <div className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-xs text-muted-foreground">开机自启动</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>默认超时设置</CardTitle>
              <CardDescription className="mt-0.5">全局默认超时时间，可在 Provider 级别覆盖</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="conn-timeout" className="text-xs">连接超时</Label>
                  <Input id="conn-timeout" type="number" defaultValue={10000} className="h-8 text-xs" placeholder="例如：10000" />
                  <p className="text-[11px] text-muted-foreground">建立连接超时（毫秒）</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="idle-timeout" className="text-xs">空闲超时</Label>
                  <Input id="idle-timeout" type="number" defaultValue={30000} className="h-8 text-xs" placeholder="例如：30000" />
                  <p className="text-[11px] text-muted-foreground">服务端无数据返回超时（毫秒）</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="total-timeout" className="text-xs">总超时</Label>
                  <Input id="total-timeout" type="number" defaultValue={300000} className="h-8 text-xs" placeholder="例如：300000" />
                  <p className="text-[11px] text-muted-foreground">请求总时长上限（毫秒）</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>上游代理</CardTitle>
              <CardDescription className="mt-0.5">通过代理访问上游 API（可选）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-center gap-2">
                <div className="h-4 w-7 rounded-full bg-muted relative cursor-pointer shrink-0">
                  <div className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-xs text-muted-foreground">启用上游代理</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 opacity-50">
                <div className="space-y-1.5">
                  <Label className="text-xs">代理地址</Label>
                  <Input placeholder="http://127.0.0.1:7890" disabled className="h-8 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">代理类型</Label>
                  <Select defaultValue="http" disabled>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="socks5">SOCKS5</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button className="h-8 px-3 text-xs">保存设置</Button>
          </div>
        </TabsContent>

        {/* 健康检查 */}
        <TabsContent value="health" className="space-y-4 mt-0">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>健康检查策略</CardTitle>
              <CardDescription className="mt-0.5">控制 Provider 故障检测和冷却行为</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fail-threshold" className="text-xs">连续失败阈值</Label>
                  <Input id="fail-threshold" type="number" defaultValue={3} className="h-8 text-xs" placeholder="例如：3" />
                  <p className="text-[11px] text-muted-foreground">达到此次数进入冷却</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="init-cooldown" className="text-xs">初始冷却时间</Label>
                  <Input id="init-cooldown" type="number" defaultValue={30} className="h-8 text-xs" placeholder="例如：30" />
                  <p className="text-[11px] text-muted-foreground">秒</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max-cooldown" className="text-xs">最大冷却时间</Label>
                  <Input id="max-cooldown" type="number" defaultValue={300} className="h-8 text-xs" placeholder="例如：300" />
                  <p className="text-[11px] text-muted-foreground">秒，指数退避上限</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-7 rounded-full bg-primary relative cursor-pointer shrink-0">
                  <div className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-xs text-muted-foreground">成功一次后重置失败计数</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>主动探测</CardTitle>
              <CardDescription className="mt-0.5">定期发送探测请求检查 Provider 可用性</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-center gap-2">
                <div className="h-4 w-7 rounded-full bg-muted relative cursor-pointer shrink-0">
                  <div className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-xs text-muted-foreground">启用主动探测</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 opacity-50">
                <div className="space-y-1.5">
                  <Label className="text-xs">探测间隔</Label>
                  <Input type="number" defaultValue={60} disabled className="h-8 text-xs" />
                  <p className="text-[11px] text-muted-foreground">秒</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">探测模型</Label>
                  <Input placeholder="使用各绑定的模型" disabled className="h-8 text-xs" />
                  <p className="text-[11px] text-muted-foreground">留空使用绑定的模型</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button className="h-8 px-3 text-xs">保存设置</Button>
          </div>
        </TabsContent>

        {/* 日志配置 */}
        <TabsContent value="logs" className="space-y-4 mt-0">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>请求日志</CardTitle>
              <CardDescription className="mt-0.5">记录所有经过代理的请求</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="flex items-center gap-2">
                <div className="h-4 w-7 rounded-full bg-primary relative cursor-pointer shrink-0">
                  <div className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm" />
                </div>
                <span className="text-xs text-muted-foreground">启用请求日志</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="log-retention" className="text-xs">日志保留天数</Label>
                  <Input id="log-retention" type="number" defaultValue={30} className="h-8 text-xs" placeholder="例如：30" />
                  <p className="text-[11px] text-muted-foreground">超过自动清理</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="log-level" className="text-xs">日志级别</Label>
                  <Select defaultValue="all">
                    <SelectTrigger id="log-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      <SelectItem value="failed">仅失败</SelectItem>
                      <SelectItem value="off">关闭</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-7 rounded-full bg-muted relative cursor-pointer shrink-0">
                    <div className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm" />
                  </div>
                  <span className="text-xs text-muted-foreground">记录请求和响应内容</span>
                </div>
                <p className="text-[11px] text-warning flex items-center gap-1.5 pl-9">
                  <AlertTriangle size={11} />
                  开启后会存储完整的请求和响应体，可能包含敏感信息
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>数据管理</CardTitle>
              <CardDescription className="mt-0.5">数据库和日志文件管理</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">数据库大小</Label>
                  <div className="text-xs font-medium">12.4 MB</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">日志记录数</Label>
                  <div className="text-xs font-medium">28,456 条</div>
                </div>
                <div className="space-y-1 sm:col-span-1 col-span-2">
                  <Label className="text-[11px] text-muted-foreground">数据目录</Label>
                  <div className="text-xs font-mono truncate">~/Library/Application Support/one-switch</div>
                </div>
              </div>
              <Separator />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                  <FolderOpen size={13} /> 打开数据目录
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                  <Download size={13} /> 导出日志
                </Button>
                <Button variant="destructive" size="sm" className="h-7 px-2 text-xs">
                  <Trash2 size={13} /> 清空日志
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button className="h-8 px-3 text-xs">保存设置</Button>
          </div>
        </TabsContent>

        {/* 关于 */}
        <TabsContent value="about" className="mt-0">
          <Card>
            <CardContent className="py-10 text-center">
              <div className="text-4xl mb-3">🔀</div>
              <h2 className="text-xl font-semibold mb-0.5">One Switch</h2>
              <p className="text-xs text-muted-foreground mb-6">本地大模型代理自动切换工具</p>
              <div className="grid grid-cols-2 gap-0 max-w-xs mx-auto mb-6 rounded-md border">
                <div className="p-3 border-r">
                  <div className="text-[11px] text-muted-foreground mb-0.5">版本</div>
                  <div className="text-sm font-semibold">v0.1.0</div>
                </div>
                <div className="p-3">
                  <div className="text-[11px] text-muted-foreground mb-0.5">构建</div>
                  <div className="text-sm font-semibold">2024.02.15</div>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                  <RefreshCw size={13} /> 检查更新
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                  <GitBranch size={13} /> GitHub
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                  <Bug size={13} /> 反馈问题
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-6">
                不做协议转换 · 永远只有一个队列 · 故障自动切换
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </PageContent>
    </PageLayout>
  )
}
