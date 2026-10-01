import { useNavigate, useParams } from '@tanstack/react-router'
import { CircleSlash, Zap } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useClientConfigFill, useClientConfigOverview } from '@/data/client-config'
import { routePaths } from '@/routing/routes'
import { CoverageBadge } from './components/coverage-badge'
import { ConfigEditorBody } from './components/config-editor-body'
import { VersionMenu } from './components/version-menu'
import { describeFill } from './lib/fill-summary'
import { useClientConfigEditor } from './hooks/use-client-config-editor'

/**
 * 单个客户端的详情与编辑。
 *
 * 版面自上而下是三件事——上面是**哪份文件**（只有多文件客户端才需要选），中间是**要写进去的值**
 * （决定），下面是**文件真正的样子**（事实）。退路不在版面里：版本历史是页头右上角的一个下拉，
 * 紧跟在「一键生效」右边，因为它是这两个动作的兜底，而不是某一块内容的附属品。
 *
 * 客户端由路由参数决定，不从下拉里选：进详情页的前提就是「我要看这一个」。
 * 面包屑因此写全「客户端配置 › 当前客户端」两级——只写上一级的话，它读起来像一个小标题，
 * 没人知道那是个能点的返回入口（与统计分析子页 `overview/page.tsx` 同一套面子）。
 *
 * 所有文件读写都走管理服务，界面只报「客户端 X 的 Y 文件」，路径永远不由界面拼出来。
 */
export function ClientConfigDetailPage() {
  const t = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  // 详情子路由带 `$clientKey`，列表索引页没有，`strict: false` 拿到整个路由树的参数并集。
  const { clientKey = '' } = useParams({ strict: false })
  const overviewItem = useClientConfigOverview().find(item => item.clientKey === clientKey)

  /*
   * 编辑这套（选文件 / 两处草稿 / 保存 / 回退）整体收在 `useClientConfigEditor` 里，
   * 引导页「接入工具」那一步嵌的就是同一套：状态与动作共用，版面各写各的。
   * 页面头上只用到一小部分（状态徽标、版本下拉、骨架要的行数），正文整块交给 `ConfigEditorBody`。
   */
  const editor = useClientConfigEditor(clientKey)
  const { client, state, status, versions, versionsLoading, restoreVersion, restoringId, slots, configurable } = editor

  const fill = useClientConfigFill()

  // 详情页复用列表页的一键生效：看到某一项「待生效」时，最自然的下一步是就地补上，
  // 不必退回列表再找那一行。结果提示与列表页同一套口径。
  const fillNow = () => {
    fill.mutate(
      { clientKey },
      {
        onSuccess: results => toast.success(describeFill(t, results)),
        onError: error => toast.error(error.message),
      },
    )
  }

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
        // 不支持自动填充的客户端不给那颗按钮：「点了没反应」比没有按钮更让人困惑。
        // 版本历史不受这个限制——手改内容同样会产生版本，它不该跟着一键生效一起消失。
        actions={(
          <>
            {overviewItem?.coverage === 'unavailable' ? null : (
              <Button disabled={fill.isPending} onClick={fillNow}>
                <Zap size={14} /> {t('clientConfig.fill.one')}
              </Button>
            )}
            <VersionMenu
              currentHash={state?.contentHash ?? ''}
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
        ) : status.error ? (
          /*
           * 读不到就说读不到，不要一直摆骨架：管理服务没起来时首屏就是这个样子，
           * 而「永远在加载」会让人以为是自己等得不够久。原始报错留在描述里，
           * 好让「服务没开」和「文件权限不对」这两件事自己能分辨。
           */
          <EmptyState icon={CircleSlash} title={t('clientConfig.loadFailed')} description={status.error} />
        ) : status.loading || !state ? (
          <CardSkeletons filePicker={client.files.length > 1} slots={slots} />
        ) : (
          <ConfigEditorBody editor={editor} />
        )}
      </PageContent>
    </PageLayout>
  )
}

/*
 * 首屏骨架的尺寸是照着上面那几块的真身量的，不是随手给个方块。
 *
 * 骨架一旦比真身矮，内容到位的那一帧整页就会往下跳——「加载完成」本该是最安静的一瞬间。
 * 所以行数直接问注册表（结果在静态表里，不必等服务端）；只有正文编辑器要等文件到手才知道多高，
 * 那里就取一个常见配置的落点（见下方的 `SKELETON_EDITOR_HEIGHT`）。
 */
const SKELETON_CHROME_PLAIN = 67 // 卡片头（只有标题）49 + 18：可自动改写的客户端，`要写入的模型` 那张卡没有描述
const SKELETON_ROW_HEIGHT = 56
/** 文件选择那一块现在是一条只有一行的前提带（不是卡）：32px 下拉 + 上下各 10px + 上下边框。 */
const SKELETON_FILE_BAND_HEIGHT = 54
// 正文编辑器随着文件长度长，本来就没有标准高度，取一份十几行配置的落点——差几十像素看不出来，
// 但按最小高度（`min-h-72`）摆的话，真实内容一到手整页就要往下跳一大截。
const SKELETON_EDITOR_HEIGHT = 460

interface CardSkeletonsProps {
  /** 多文件客户端才有「选择配置文件」那一条前提带。 */
  filePicker: boolean
  /** 「要写入的模型」有几行，由配方决定；0 表示这个客户端没有那一块，骨架也不能多摆一块。 */
  slots: number
}

function CardSkeletons(props: CardSkeletonsProps) {
  const { filePicker, slots } = props
  // 返回 Fragment 而不是包一层 div：它们本来就该是 `PageContent` 网格的直接子项，间距才和真身一致。
  return (
    <>
      {filePicker && (
        <Skeleton className="w-full rounded-xl" style={{ height: SKELETON_FILE_BAND_HEIGHT }} />
      )}
      {slots > 0 && (
        <Skeleton
          className="w-full rounded-xl"
          style={{ height: SKELETON_CHROME_PLAIN + slots * SKELETON_ROW_HEIGHT }}
        />
      )}
      <Skeleton className="w-full rounded-xl" style={{ height: SKELETON_EDITOR_HEIGHT }} />
    </>
  )
}
