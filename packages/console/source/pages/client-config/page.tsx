import { CircleSlash, Wrench, Zap } from 'lucide-react'
import { AddressCard } from '@/components/address-card'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useAccessConfig } from '@/hooks/use-access-config'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useClientConfigFill, useClientConfigOverview, useClientConfigOverviewStatus } from '@/data/client-config'
import { ClientListHeader, ClientRow } from './components/client-row'
import { ProtocolCard } from './components/protocol-card'
import { describeFill, firstFillError } from './lib/fill-summary'

/**
 * 客户端配置。
 *
 * 这一页只回答两件事：**哪些客户端还没指向 One Switch**，以及**哪些已经留了可回退的版本**。
 * 所以主版面是一张客户端列表——一行一个，左边是图标与名字，右边是配置覆盖状态、最近更新时间
 * 与版本数，点任意一行进详情看那份文件的原文与历史，右上角一颗「一键生效」把能自动改的一次性改完。
 *
 * 列表上面两张卡：**要填的值**（地址 + 密钥，能照抄）与**支持的协议**（每个协议配哪条路径）。
 * 列表只覆盖注册表里认识的工具，而接得上的工具远比这份名单多——只要客户端能配成那几条路径之一，
 * 把同样的地址、密钥填进它自己的配置就能跑。两张卡都是**参考**，不是这一页的正文，
 * 所以宽屏并排、窄屏堆叠，不摊成满宽的一大块（见 `AddressCard` / `ProtocolCard`）。
 * 两张卡也不写任何工具名（与引导页同一个规矩）：能接的是协议，不是我们认识的牌子，
 * 列名字等于替用户判断他手上的工具在不在其中。
 *
 * 逐行不再摆「一键生效」：这一页的一键生效是标题栏那一颗，逐行再来一颗，同一件事就有两种入口，
 * 而这一页真正要下钻的是「这一行到底改了什么」——单个客户端的生效在详情页里，那里能看到要改的那几行。
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
  const access = useAccessConfig()
  const { copiedKey, copy } = useCopyToClipboard()

  const report = (results: Parameters<typeof describeFill>[1]) => {
    const summary = describeFill(t, results)
    const failure = firstFillError(results)
    // 有失败就是失败：一条红字带原因，比一条绿色的「部分完成」更不容易被扫过去。
    if (failure) toast.error(`${summary}\n${failure}`)
    else toast.success(summary)
  }

  const fillAll = () => fill.mutate({}, { onSuccess: report, onError: error => toast.error(error.message) })

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
        {/*
          两张「怎么接」的卡与列表的读取状态无关：读不到列表时它们照样成立，
          也不是「空列表」的替身。宽屏并排（两张卡各自不长，堆着会白占两行高度），窄屏堆叠。
          **并排时两张卡等高**（不加 `items-start`，就是网格默认的 stretch）：这两张是同一排的两块
          参考，一高一矮会让上面这条边看着没对齐；高的那张决定高度，矮的那张把多出来的空间
          摊到卡片下沿的留白里，卡里的行仍各按各的行高排。
        */}
        <div className="grid gap-4 lg:grid-cols-2">
          <AddressCard
            origin={access.origin}
            copiedKey={copiedKey}
            onCopy={copy}
            title={t('clientConfig.manual.access.title')}
            description={t('clientConfig.manual.access.description')}
            showModelName={false}
          />
          <ProtocolCard />
        </div>

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
            {/* 骨架的形状照着真身量：一条表头条 + 若干条行条，不要摆成“带留白的方块列表”。 */}
            <CardContent className="p-0">
              <div className="hidden border-b border-border/50 px-4 py-2.5 md:block">
                <Skeleton className="h-3 w-40 rounded-sm" />
              </div>
              <div className="divide-y divide-border/50">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div className="px-4 py-2.5" key={index}>
                    <Skeleton className="h-9 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <EmptyState icon={Wrench} title={t('clientConfig.noClients')} />
        ) : (
          <Card className="pb-0">
            <SettingsCardHeader icon={<Wrench />} title={t('clientConfig.list.title')} description={t('clientConfig.list.description')} />
            {/* 行要贴到卡片边缘，所以内容区自己去掉留白，卡片自身去掉底部留白。 */}
            <CardContent className="p-0">
              <ClientListHeader />
              <ul className="divide-y divide-border/50">
                {items.map(item => (
                  <ClientRow item={item} key={item.clientKey} />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </PageContent>
    </PageLayout>
  )
}
