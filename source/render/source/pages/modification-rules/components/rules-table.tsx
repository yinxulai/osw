import { Copy, Globe2, Link2, Pencil, Search, Trash2 } from 'lucide-react'
import { InlineEmptyState } from '@/components/inline-empty-state'
import { tableHeaderClass, tableRowClass } from '@/components/table-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RequestRewriteRule, RuleStatusFilter } from '../types'

interface RulesTableProps {
  rules: RequestRewriteRule[]
  search: string
  statusFilter: RuleStatusFilter
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: RuleStatusFilter) => void
  onEdit: (rule: RequestRewriteRule) => void
  onDuplicate: (rule: RequestRewriteRule) => void
  onDelete: (rule: RequestRewriteRule) => void
  onToggle: (rule: RequestRewriteRule, enabled: boolean) => void
}

export function RulesTable(props: RulesTableProps) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-col gap-3 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>规则列表</CardTitle>
          <CardDescription>启用后的全局规则自动应用；普通规则需要在供应商管理中添加。</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={props.search}
              onChange={event => props.onSearchChange(event.target.value)}
              placeholder="搜索规则"
              className="h-8 pl-8 text-xs"
              aria-label="搜索规则"
            />
          </div>
          <Select value={props.statusFilter} onValueChange={value => props.onStatusFilterChange(value as RuleStatusFilter)}>
            <SelectTrigger className="h-8 w-28 text-xs" aria-label="筛选规则状态">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="enabled">已启用</SelectItem>
              <SelectItem value="disabled">已停用</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table className="w-full min-w-205 text-left text-xs">
          <TableHeader className={tableHeaderClass}>
            <TableRow>
              <TableHead className="px-4 py-2">规则</TableHead>
              <TableHead className="w-28 px-3 py-2">作用范围</TableHead>
              <TableHead className="w-24 px-3 py-2">阶段</TableHead>
              <TableHead className="w-44 px-3 py-2">匹配协议</TableHead>
              <TableHead className="w-24 px-3 py-2">动作</TableHead>
              <TableHead className="w-24 px-3 py-2">状态</TableHead>
              <TableHead className="w-32 px-4 py-2 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border/60">
            {props.rules.map(rule => (
              <TableRow key={rule.id} className={tableRowClass}>
                <TableCell className="px-4 py-2.5">
                  <button type="button" onClick={() => props.onEdit(rule)} className="block max-w-80 text-left">
                    <span className="block truncate text-xs font-medium hover:text-primary">{rule.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{rule.description || '暂无说明'}</span>
                  </button>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  {rule.global ? (
                    <Badge variant="info" className="gap-1 font-normal"><Globe2 className="size-3" />全局</Badge>
                  ) : (
                    <div>
                      <Badge variant="outline" className="gap-1 font-normal"><Link2 className="size-3" />普通</Badge>
                      <p className="mt-1 text-[9px] text-muted-foreground">{rule.boundProviders} 个供应商</p>
                    </div>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <Badge variant={rule.actions.some(action => action.stage === 'request') ? 'secondary' : 'warning'} className="font-normal">
                    {rule.actions.some(action => action.stage === 'request') ? '请求' : ''}{rule.actions.some(action => action.stage === 'request') && rule.actions.some(action => action.stage === 'response') ? ' / ' : ''}{rule.actions.some(action => action.stage === 'response') ? '响应' : ''}
                  </Badge>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <p className="max-w-40 truncate text-[10px] text-muted-foreground" title={rule.protocols.join('、')}>
                    {rule.protocols.length ? rule.protocols.join('、') : '全部协议'}
                  </p>
                </TableCell>
                <TableCell className="px-3 py-2.5 text-[11px] text-muted-foreground">{rule.actions.length} 个</TableCell>
                <TableCell className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={enabled => props.onToggle(rule, enabled)}
                      aria-label={`${rule.name}启用状态`}
                    />
                    <span className="text-[10px] text-muted-foreground">{rule.enabled ? '启用' : '停用'}</span>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon-sm" onClick={() => props.onEdit(rule)} title="编辑规则"><Pencil /></Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => props.onDuplicate(rule)} title="复制规则"><Copy /></Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => props.onDelete(rule)} title="删除规则" className="text-muted-foreground hover:text-destructive"><Trash2 /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {props.rules.length === 0 && (
          <InlineEmptyState title="没有匹配的规则" description="尝试调整搜索词或状态筛选。" className="px-4 py-14" />
        )}
      </div>
    </Card>
  )
}
