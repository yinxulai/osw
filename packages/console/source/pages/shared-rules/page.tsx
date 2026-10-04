import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Globe2, Search, SearchX, TriangleAlert } from 'lucide-react'
import { sharedRewriteRuleApi, requestRewriteRuleApi } from '@/api/models'
import { localizeErrorCode } from '@/api/errors'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { tableHeaderClass, tableRowClass } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import type { SharedRewriteRule, SharedRewriteRuleSort } from '@common/shared-rewrite-rules'

/**
 * 共享规则目录页：浏览社区发布的重写规则，按用量排名，一键拷进本机。
 *
 * **保存即用**：这里没有「安装」。点「使用」就是把规则写进本机规则库（来源标成 `imported`），
 * 之后它和用户自建的规则走完全相同的路，不再有「它来自目录」这一区分——这也是它们能直接
 * 在请求重写页里被编辑 / 绑定的原因。
 *
 * **匿名**：浏览与保存都不需要登录，也不上报任何身份；只有「使用」会给目录里那条规则的
 * 计数 +1，用来排名。
 *
 * 搜索在**本地**过滤（目录一次把前 50 条取回）：一次点击即可命中已知项，省一次往返，
 * 也避免每敲一个字就发一遍请求。排序则必须回服务端——它决定的是「取哪 50 条」，
 * 在截断后的结果上本地重排是错的。
 */

/** 一次取回的上限。目录侧硬上限是 100，这里取 50 铺满一屏且不过分。 */
const PAGE_LIMIT = 50

export function SharedRulesPage() {
  const t = useTranslation()
  const toast = useToast()
  const [rules, setRules] = useState<SharedRewriteRule[]>([])
  const [sort, setSort] = useState<SharedRewriteRuleSort>('popular')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** 正在被「使用」的规则 id，用来禁掉按钮、防止连点。 */
  const [adoptingId, setAdoptingId] = useState<string>()

  const loadRules = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const result = await sharedRewriteRuleApi.list({ query: '', sort, limit: PAGE_LIMIT, offset: 0 })
    if (!result.success) {
      setLoadError(localizeErrorCode(result.errorCode, result.errorMessage, result.errorParams))
      setLoading(false)
      return
    }
    setRules(result.data.rules)
    setLoading(false)
  }, [sort])

  useEffect(() => { void loadRules() }, [loadRules])

  const filteredRules = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    if (!keyword) return rules
    return rules.filter(rule => `${rule.name} ${rule.description}`.toLocaleLowerCase().includes(keyword))
  }, [rules, search])

  const adoptRule = (rule: SharedRewriteRule) => {
    void (async () => {
      setAdoptingId(rule.id)
      const result = await sharedRewriteRuleApi.use(rule.id)
      setAdoptingId(undefined)
      if (!result.success) {
        toast.error(localizeErrorCode(result.errorCode, result.errorMessage, result.errorParams))
        return
      }
      // 保存成功后把计数 +1 显示出来：用户点的是「使用」，看到排名动一下才闭环。
      setRules(current => current.map(item => item.id === rule.id ? { ...item, usageCount: item.usageCount + 1 } : item))
      toast.success(t('sharedRules.used', { name: result.data.name }))
    })()
  }

  return (
    <PageLayout>
      <PageHeader title={t('sharedRules.title')} description={t('sharedRules.description')} />
      <PageContent>
        {loading && <div className="system-xs-regular text-text-tertiary">{t('sharedRules.loading')}</div>}
        {loadError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 system-xs-regular text-text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void loadRules()}>{t('common.action.retry')}</Button>
          </div>
        )}
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{t('sharedRules.table.title')}</CardTitle>
              <CardDescription>{t('sharedRules.table.description')}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary" />
                <Input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder={t('sharedRules.filter.searchPlaceholder')}
                  className="pl-9"
                  aria-label={t('sharedRules.filter.searchAria')}
                />
              </div>
              <Select value={sort} onValueChange={value => setSort(value as SharedRewriteRuleSort)}>
                <SelectTrigger className="w-32" aria-label={t('sharedRules.filter.sortAria')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="popular">{t('sharedRules.filter.sortPopular')}</SelectItem>
                  <SelectItem value="recent">{t('sharedRules.filter.sortRecent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table className={cn('w-full text-left text-xs', filteredRules.length > 0 && 'min-w-160')}>
              <TableHeader className={tableHeaderClass}>
                <TableRow>
                  <TableHead className="px-4 py-2">{t('sharedRules.table.column.rule')}</TableHead>
                  <TableHead className="w-28 px-3 py-2">{t('sharedRules.table.column.scope')}</TableHead>
                  <TableHead className="w-24 px-3 py-2">{t('sharedRules.table.column.usage')}</TableHead>
                  <TableHead className="w-40 px-3 py-2">{t('sharedRules.table.column.updated')}</TableHead>
                  <TableHead className="w-28 px-4 py-2 text-right">{t('sharedRules.table.column.operations')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRules.map(rule => (
                  <TableRow key={rule.id} className={tableRowClass}>
                    <TableCell className="px-4 py-2.5">
                      <span className="block max-w-80 truncate system-xs-medium">{rule.name}</span>
                      <span className="mt-0.5 block max-w-80 truncate system-2xs-regular text-text-tertiary">{rule.description || t('sharedRules.table.noDescription')}</span>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      {rule.scope === 'global' ? (
                        <Badge variant="info" className="gap-1 font-normal"><Globe2 className="size-3" />{t('sharedRules.scope.global')}</Badge>
                      ) : (
                        <Badge variant="outline" className="font-normal">{t('sharedRules.scope.normal')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">{t('sharedRules.table.usageCount', { count: rule.usageCount })}</TableCell>
                    <TableCell className="px-3 py-2.5">
                      <span className="system-2xs-regular text-text-tertiary">{new Date(rule.updatedTime).toLocaleString()}</span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={adoptingId === rule.id}
                          onClick={() => adoptRule(rule)}
                        >
                          <Download />
                          {adoptingId === rule.id ? t('sharedRules.action.using') : t('sharedRules.action.use')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && filteredRules.length === 0 && (
                  <TableStateRow colSpan={5} icon={SearchX} title={t('sharedRules.empty.title')} description={t('sharedRules.empty.description')} />
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </PageContent>
    </PageLayout>
  )
}

/**
 * 把一条本机规则分享到目录。供请求重写页的规则行调用。
 *
 * 放在这里而不是塞进调用方：分享的语义只有一处，避免一处改了另一处忘改。
 * 先按 id 取一次最新规则再发布——目录要的是作者撰写的最终内容，不是屏幕上那次的草稿。
 */
export async function shareRequestRewriteRule(ruleId: string): Promise<{ ok: true; rule: SharedRewriteRule } | { ok: false; message: string }> {
  const latest = await requestRewriteRuleApi.get(ruleId)
  if (!latest.success) return { ok: false, message: latest.errorMessage }
  const result = await sharedRewriteRuleApi.publish(latest.data.id)
  if (!result.success) return { ok: false, message: result.errorMessage }
  return { ok: true, rule: result.data }
}
