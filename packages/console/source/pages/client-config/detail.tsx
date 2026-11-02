import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CircleSlash, RefreshCw } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslation } from '@/i18n/provider'
import { clientConfigKeys, useClientConfigOverview } from '@/data/client-config'
import { routePaths } from '@/routing/routes'
import { ClientDetailSkeleton } from './components/client-detail-skeleton'
import { CoverageBadge } from './components/coverage-badge'
import { ConfigEditorBody } from './components/config-editor-body'
import { VersionMenu } from './components/version-menu'
import { useClientConfigEditor } from './hooks/use-client-config-editor'

/**
 * 单个客户端的详情与编辑。
 *
 * 版面自上而下是两件事——上面是**要写进去的值**（决定），下面是**文件真正的样子**（事实）；
 * 一个客户端可能有多份文件，它们收在内容模块里用标签切换，页头的「保存」一次写回所有改动过的文件。
 * 退路与写入同在页头右上角：保存、撤销，再往右是版本历史下拉——历史管的是整页、连手动保存
 * 与自动填充一起管，因此和写入同一层级，而不是某一块内容的附属品。
 *
 * 详情页不再有一条单独的「一键生效」路径：地址与密钥由服务端固定写入，模型与内容都由这台编辑器
 * 决定，用户要按的只有一颗保存——两种写入入口并存只会让人分不清哪一下才算数。列表页的「全部生成配置并应用」
 * 仍在（那里没有编辑器），它写的是同一套默认值。
 *
 * 客户端由路由参数决定，不从下拉里选：进详情页的前提就是「我要看这一个」。
 * 面包屑因此写全「客户端配置 › 当前客户端」两级——只写上一级的话，它读起来像一个小标题，
 * 没人知道那是个能点的返回入口（与统计分析子页 `overview/page.tsx` 同一套面子）。
 *
 * 所有文件读写都走管理服务，界面只报「客户端 X 的 Y 文件」，路径永远不由界面拼出来。
 */
export function ClientConfigDetailPage() {
  const t = useTranslation()
  const navigate = useNavigate()
  // 详情子路由带 `$clientKey`，列表索引页没有，`strict: false` 拿到整个路由树的参数并集。
  const { clientKey = '' } = useParams({ strict: false })
  const overviewItem = useClientConfigOverview().find(item => item.clientKey === clientKey)
  const queryClient = useQueryClient()

  /*
   * 编辑这套（选文件 / 两处草稿 / 保存 / 回退）整体收在 `useClientConfigEditor` 里，
   * 引导页「接入工具」那一步嵌的就是同一套：状态与动作共用，版面各写各的。
   * 页头用到的只有写入那几件（保存 / 撤销 / 版本下拉），正文整块交给 `ConfigEditorBody`。
   */
  const editor = useClientConfigEditor(clientKey)
  const { client, loading, error, versions, versionsLoading, restoreVersion, restoringId, slots, configurable, dirtyFilePaths, saving, saveAll, discardFile } = editor

  // 撤销只作用于当前展开的那一份（与内容模块的标签同源）；保存写的是全部改动过的那几份。
  const active = editor.files.find(file => file.filePath === editor.activeFilePath) ?? editor.files[0]
  const dirtyCount = dirtyFilePaths.length

  const backToList = () => void navigate({ to: routePaths.clientConfig })

  return (
    <PageLayout>
      <PageHeader
        breadcrumb={client?.name ?? clientKey}
        title={client?.name ?? clientKey}
        // 标题后面只挂状态徽标：名字本身已经把身份说清楚了，再塞一枚品牌图标，读起来是「名字 + 两个徽标」
        // ——需要图标帮忙分辨的是列表页的每一行，那里才有它的位置。
        titleAdornment={
          overviewItem && (
            <CoverageBadge autoFill={overviewItem.autoFill} coverage={overviewItem.coverage} pendingChanges={overviewItem.pendingChanges} />
          )
        }
        description={t(configurable ? 'clientConfig.detail.description' : 'clientConfig.detail.descriptionManual')}
        // 写入这件事只有一处：保存写的是编辑器里全部改动过的文件，撤销只退当前展开的那一份。
        // 客户端还没到手时不摆这两颗按钮——那会儿既没有「当前文件」，也谈不上改动。
        actions={(
          <>
            {client && (
              <>
                <Button disabled={!active?.dirty || saving} variant="outline" onClick={() => active && discardFile(active.filePath)}>
                  {t('clientConfig.discard')}
                </Button>
                <Button disabled={dirtyCount === 0 || saving} onClick={saveAll}>
                  {saving ? t('clientConfig.saving') : dirtyCount > 1 ? t('clientConfig.saveAll', { count: dirtyCount }) : t('clientConfig.saveContent')}
                </Button>
              </>
            )}
            <VersionMenu
              currentHash={editor.files.find(file => file.filePath === editor.activeFilePath)?.state?.contentHash ?? ''}
              loading={versionsLoading}
              onRestore={restoreVersion}
              restoringId={restoringId}
              versions={versions}
            />
          </>
        )}
      />

      <PageContent>
        {!client ? (
          <EmptyState
            action={<Button variant="outline" onClick={backToList}>{t('clientConfig.detail.back')}</Button>}
            icon={CircleSlash}
            title={t('clientConfig.unknownClient')}
          />
        ) : error ? (
          /*
           * 读不到就说读不到，不要一直摆骨架：管理服务没起来时首屏就是这个样子，
           * 而「永远在加载」会让人以为是自己等得不够久。原始报错留在描述里，
           * 好让「服务没开」和「文件权限不对」这两件事自己能分辨。
           */
          <EmptyState
            icon={CircleSlash}
            title={t('clientConfig.loadFailed')}
            description={error}
            action={(
              <Button variant="outline" onClick={() => void queryClient.invalidateQueries({ queryKey: clientConfigKeys.all })}>
                <RefreshCw size={14} />
                {t('common.action.retry')}
              </Button>
            )}
          />
        ) : loading ? (
          <ClientDetailSkeleton fileTabs={client.files.length > 1} slots={slots} />
        ) : (
          <ConfigEditorBody editor={editor} />
        )}
      </PageContent>
    </PageLayout>
  )
}
