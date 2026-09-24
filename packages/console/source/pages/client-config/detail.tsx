import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { CircleSlash, Zap } from 'lucide-react'
import type { ClientConfigVersionSummary } from '@common/client-config'
import { agentClientModelSlots, findAgentClientApplyConfig } from '@common/clients'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME } from '@common/schemas'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import {
  useClientConfigActions,
  useClientConfigFile,
  useClientConfigFileStatus,
  useClientConfigFill,
  useClientConfigOverview,
  useClientConfigVersions,
  useClientConfigVersionsLoading,
} from '@/data/client-config'
import { AGENT_CLIENT_DEFINITION_BY_KEY } from '@/catalog/clients'
import { formatBytes } from '@/lib/format-bytes'
import { routePaths } from '@/routing/routes'
import { CoverageBadge } from './components/coverage-badge'
import { FilePickerCard } from './components/file-picker-card'
import { ValuesCard, type ClientConfigValues } from './components/values-card'
import { ContentCard } from './components/content-card'
import { VersionMenu } from './components/version-menu'
import { describeFill } from './lib/fill-summary'

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
  const client = AGENT_CLIENT_DEFINITION_BY_KEY[clientKey]
  const overviewItem = useClientConfigOverview().find(item => item.clientKey === clientKey)

  const [selectedFilePath, setSelectedFilePath] = useState('')
  // 只记「上一回写了几处」而不留整张清单：界面用它报状态，清单本身已经体现在文件内容与版本历史里了。
  const [appliedCount, setAppliedCount] = useState(0)

  // `$clientKey` 变了组件并不重挂，`useState` 的初值不会再算一遍：所以「选中的文件」只在它确实属于
  // 当前客户端时才作数，否则从 A 的详情走到 B 的详情会拿着 A 的路径去读，服务端只会回一句「不在清单里」。
  const filePath = client !== undefined && client.files.some(file => file.path === selectedFilePath)
    ? selectedFilePath
    : client?.files[0]?.path ?? ''

  // 同上，写入成绩也不能跨客户端带走：换一个客户端就重新记。
  useEffect(() => {
    setAppliedCount(0)
  }, [clientKey])

  const state = useClientConfigFile(clientKey, filePath)
  const status = useClientConfigFileStatus(clientKey, filePath)
  const versions = useClientConfigVersions(clientKey, filePath)
  const versionsLoading = useClientConfigVersionsLoading(clientKey, filePath)
  const actions = useClientConfigActions(clientKey, filePath)
  const fill = useClientConfigFill()

  // 备份结果要说清「为什么没存」：文件本来不存在，和内容已经在历史里，是两件事。
  // 前者没什么可备份的，后者说明这份内容早就是某个版本了——判断靠写入前的存在性，所以要提前记下来。
  const existedBeforeRef = useRef(false)
  const rememberExistence = () => {
    existedBeforeRef.current = state?.exists ?? false
  }

  const describeBackup = (backedUp: ClientConfigVersionSummary | null) => {
    if (backedUp) return t('clientConfig.backup.created', { size: formatBytes(backedUp.sizeBytes) })
    return existedBeforeRef.current ? t('clientConfig.backup.existing') : t('clientConfig.backup.skipped')
  }

  const selectFile = (nextPath: string) => {
    setSelectedFilePath(nextPath)
    setAppliedCount(0)
  }

  const applyValues = (values: ClientConfigValues) => {
    rememberExistence()
    actions.apply.mutate(
      { ...values, smallModel: values.smallModel || undefined },
      {
        onSuccess: result => {
          setAppliedCount(result.changes.length)
          toast.success(`${t('clientConfig.toast.applied', { count: result.changes.length })} ${describeBackup(result.backedUp)}`)
        },
        onError: error => toast.error(error.message),
      },
    )
  }

  const saveContent = (content: string) => {
    rememberExistence()
    actions.save.mutate(
      { content },
      {
        onSuccess: result => toast.success(`${t('clientConfig.toast.saved')} ${describeBackup(result.backedUp)}`),
        onError: error => toast.error(error.message),
      },
    )
  }

  const restoreVersion = (id: string) => {
    rememberExistence()
    actions.restore.mutate(
      { id },
      {
        onSuccess: result => {
          setAppliedCount(0)
          toast.success(`${t('clientConfig.toast.restored')} ${describeBackup(result.backedUp)}`)
        },
        onError: error => toast.error(error.message),
      },
    )
  }

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

  /*
   * 两块内容都拿这一串当 `key`：文件一变（刚被写、被回退、换了个客户端），表单与草稿就都该按
   * **新的**现状重新初始化。这也顺手免掉了一个 effect —— 那类「把 props 同步进 state」的写法
   * 是这个仓库里最容易写出无限渲染循环的地方。
   */
  const stateKey = `${clientKey}|${filePath}|${state?.contentHash ?? ''}`

  // 骨架屏要摆几行由注册表说了算，不必等管理服务回话：配方在静态表里，界面自己就能数出来。
  const applyConfig = findAgentClientApplyConfig(clientKey)
  const skeletonSlots = applyConfig ? agentClientModelSlots(applyConfig).length : 0

  return (
    <PageLayout>
      <PageHeader
        breadcrumbs={[
          { label: t('clientConfig.title'), onClick: backToList },
          // 末级不是按钮：它说的是「你正在看的就是这一个」，不需要再点一次。
          { label: client?.name ?? clientKey },
        ]}
        title={client?.name ?? clientKey}
        // 标题后面只挂状态徽标：名字本身已经把身份说清楚了，再塞一枚品牌图标，读起来是「名字 + 两个徽标」
        // ——需要图标帮忙分辨的是列表页的每一行，那里才有它的位置。
        titleAdornment={
          overviewItem && (
            <CoverageBadge autoFill={overviewItem.autoFill} coverage={overviewItem.coverage} pendingChanges={overviewItem.pendingChanges} />
          )
        }
        description={t('clientConfig.detail.description')}
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
              restoringId={actions.restore.isPending ? (actions.restore.variables?.id ?? null) : null}
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
          <CardSkeletons filePicker={client.files.length > 1} slots={skeletonSlots} />
        ) : (
          <>
            {/* 只有多文件客户端（Gemini CLI、OpenCode、Pi）才需要这一步；单文件时路径在内容卡片里已经写着。 */}
            {client.files.length > 1 && <FilePickerCard filePath={filePath} files={client.files} onSelectFile={selectFile} />}

            {/* `key` 的来由见上面 `stateKey`：内容一变，表单与草稿都重新初始化。 */}
            <ValuesCard
              key={`values|${stateKey}`}
              applying={actions.apply.isPending}
              appliedCount={appliedCount}
              autoFill={state.autoFill}
              clientKey={clientKey}
              defaultModel={BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME}
              detected={state.detected}
              onApply={applyValues}
            />

            <ContentCard key={`content|${stateKey}`} saving={actions.save.isPending} state={state} onSave={saveContent} />
          </>
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
const SKELETON_CHROME_WITH_DESCRIPTION = 83 // 卡片头（带描述）65 + 卡片自身剩下的内边距 18
const SKELETON_CHROME_PLAIN = 67 // 卡片头（只有标题）49 + 18：`要写入的模型` 那张卡没有描述
const SKELETON_ROW_HEIGHT = 56
const SKELETON_VALUES_FOOTER = 57
// 正文编辑器随着文件长度长，本来就没有标准高度，取一份十几行配置的落点——差几十像素看不出来，
// 但按最小高度（`min-h-72`）摆的话，真实内容一到手整页就要往下跳一大截。
const SKELETON_EDITOR_HEIGHT = 460

interface CardSkeletonsProps {
  /** 多文件客户端才有「选择配置文件」那一块。 */
  filePicker: boolean
  /** 「要写入的模型」有几行，由配方决定。 */
  slots: number
}

function CardSkeletons(props: CardSkeletonsProps) {
  const { filePicker, slots } = props
  // 返回 Fragment 而不是包一层 div：它们本来就该是 `PageContent` 网格的直接子项，间距才和真身一致。
  return (
    <>
      {filePicker && (
        <Skeleton className="w-full rounded-xl" style={{ height: SKELETON_CHROME_WITH_DESCRIPTION + SKELETON_ROW_HEIGHT }} />
      )}
      <Skeleton
        className="w-full rounded-xl"
        style={{ height: SKELETON_CHROME_PLAIN + slots * SKELETON_ROW_HEIGHT + SKELETON_VALUES_FOOTER }}
      />
      <Skeleton className="w-full rounded-xl" style={{ height: SKELETON_EDITOR_HEIGHT }} />
    </>
  )
}
