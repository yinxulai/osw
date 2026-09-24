import { CircleSlash, Wrench, Zap } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useClientConfigFill, useClientConfigOverview, useClientConfigOverviewStatus } from '@/data/client-config'
import { ClientRow } from './components/client-row'
import { describeFill, firstFillError } from './lib/fill-summary'

/**
 * 客户端配置。
 *
 * 这一页只回答两件事：**哪些客户端还没指向 One Switch**，以及**哪些已经留了可回退的版本**。
 * 所以主版面是一张客户端列表——一行一个，左边是图标与名字，右边是配置覆盖状态、最近更新时间
 * 与版本数，右上角一颗「一键生效」把能自动改的一次性改完，点任意一行进详情看那份文件的原文与历史。
 *
 * 为什么不在这里直接把表单摊开：八个客户端里只有四个能被自动填充，把表单铺在主页的结果是
 * 「另一多半」永远只是列表里的一行说明。列表先给全局，再逐行下钻，两边都不挤。
 *
 * 读写全部发生在管理服务（core）：只有它拿得到真实主目录与进程环境变量，也只有它手里有
 * 「注册表声明过的路径」这份白名单。控制台只说「客户端 X 的 Y 文件」，路径从不由界面拼出来——
 * 管理 API 没有身份校验（见 `docs/product/security-privacy.md`），能写哪个文件绝不能由调用方决定。
 */
export function ClientConfigPage() {
  const t = useTranslation()
  const toast = useToast()
  const items = useClientConfigOverview()
  const status = useClientConfigOverviewStatus()
  const fill = useClientConfigFill()

  const report = (results: Parameters<typeof describeFill>[1]) => {
    const summary = describeFill(t, results)
    const failure = firstFillError(results)
    // 有失败就是失败：一条红字带原因，比一条绿色的「部分完成」更不容易被扫过去。
    if (failure) toast.error(`${summary}\n${failure}`)
    else toast.success(summary)
  }

  const fillAll = () => fill.mutate({}, { onSuccess: report, onError: error => toast.error(error.message) })
  const fillOne = (clientKey: string) => fill.mutate({ clientKey }, { onSuccess: report, onError: error => toast.error(error.message) })

  return (
    <PageLayout>
      <PageHeader
        title={t('clientConfig.title')}
        description={t('clientConfig.description')}
        actions={
          <Button disabled={fill.isPending} onClick={fillAll}>
            <Zap size={14} /> {fill.isPending ? t('clientConfig.fill.running') : t('clientConfig.fill.all')}
          </Button>
        }
      />

      <PageContent>
        {status.error ? (
          /*
           * 读不到就说读不到，不要一直摆骨架：管理服务没起来时首屏就是这个样子，
           * 而「永远在加载」会让人以为是自己等得不够久。原始报错留在描述里，
           * 好让「服务没开」和「文件权限不对」这两件事自己能分辨。
           */
          <EmptyState icon={CircleSlash} title={t('clientConfig.loadFailed')} description={status.error} />
        ) : status.loading ? (
          <Card className="pb-0">
            <SettingsCardHeader icon={<Wrench />} title={t('clientConfig.list.title')} description={t('clientConfig.list.description')} />
            <CardContent className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton className="h-10 w-full rounded-lg" key={index} />
              ))}
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <EmptyState icon={Wrench} title={t('clientConfig.noClients')} />
        ) : (
          <Card className="pb-0">
            <SettingsCardHeader icon={<Wrench />} title={t('clientConfig.list.title')} description={t('clientConfig.list.description')} />
            {/* 行要贴到卡片边缘，所以内容区自己去掉留白，卡片自身去掉底部留白。 */}
            <CardContent className="p-0">
              <ul className="divide-y divide-border/50">
                {items.map(item => (
                  <ClientRow busy={fill.isPending} item={item} key={item.clientKey} onFill={() => fillOne(item.clientKey)} />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </PageContent>
    </PageLayout>
  )
}
