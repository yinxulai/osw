import { useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { CircleSlash, Zap } from 'lucide-react'
import type { ClientConfigChange, ClientConfigVersionSummary } from '@common/client-config'
import { resolveProxyOrigin } from '@common/proxy-origin'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME } from '@common/schemas'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useProxyStatus } from '@/data/proxy'
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
import { ClientIcon } from './components/client-icon'
import { CoverageBadge } from './components/coverage-badge'
import { FilePickerCard } from './components/file-picker-card'
import { ValuesCard, type ClientConfigValues } from './components/values-card'
import { ContentCard } from './components/content-card'
import { HistoryCard } from './components/history-card'
import { describeFill } from './lib/fill-summary'

/**
 * 单个客户端的详情与编辑。
 *
 * 版面自上而下是三件事——上面是**哪份文件**（只有多文件客户端才需要选），中间是**要写进去的值**
 * （决定），下面是**文件真正的样子**与**它之前的样子**（事实与退路）。写完立刻能在下面看到落盘结果，
 * 不喜欢就退回上一版。客户端由路由参数决定，不从下拉里选：进详情页的前提就是「我要看这一个」。
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

  const [filePath, setFilePath] = useState(() => client?.files[0]?.path ?? '')
  const [changes, setChanges] = useState<ClientConfigChange[]>([])

  const state = useClientConfigFile(clientKey, filePath)
  const status = useClientConfigFileStatus(clientKey, filePath)
  const versions = useClientConfigVersions(clientKey, filePath)
  const versionsLoading = useClientConfigVersionsLoading(clientKey, filePath)
  const actions = useClientConfigActions(clientKey, filePath)
  const fill = useClientConfigFill()

  const proxyStatus = useProxyStatus()
  const defaultBaseUrl = resolveProxyOrigin(proxyStatus?.host ?? '', proxyStatus?.port ?? null) ?? ''

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
    setFilePath(nextPath)
    setChanges([])
  }

  const applyValues = (values: ClientConfigValues) => {
    rememberExistence()
    actions.apply.mutate(
      { ...values, smallModel: values.smallModel || undefined },
      {
        onSuccess: result => {
          setChanges(result.changes)
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
          setChanges([])
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

  return (
    <PageLayout>
      <PageHeader
        breadcrumbs={[{ label: t('clientConfig.title'), onClick: backToList }]}
        title={client?.name ?? clientKey}
        titleAdornment={
          client && (
            <span className="flex items-center gap-2">
              <ClientIcon clientKey={clientKey} size={18} />
              {overviewItem && (
                <CoverageBadge autoFill={overviewItem.autoFill} coverage={overviewItem.coverage} pendingChanges={overviewItem.pendingChanges} />
              )}
            </span>
          )
        }
        description={t('clientConfig.detail.description')}
        // 不支持自动填充的客户端不给这颗按钮：「点了没反应」比没有按钮更让人困惑。
        actions={overviewItem?.coverage === 'unavailable' ? undefined : (
          <Button disabled={fill.isPending} onClick={fillNow}>
            <Zap size={14} /> {t('clientConfig.fill.one')}
          </Button>
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
          <CardSkeletons />
        ) : (
          <>
            {/* 只有多文件客户端（Gemini CLI、OpenCode、Pi）才需要这一步；单文件时路径在内容卡片里已经写着。 */}
            {client.files.length > 1 && <FilePickerCard filePath={filePath} files={client.files} onSelectFile={selectFile} />}

            {/*
             * `key` 里带上内容摘要：文件内容一变（无论是刚被写、还是被回退），表单与草稿都该
             * 按**新的**现状重新初始化。这样做同时免掉了一个 effect —— 那类「把 props 同步进 state」
             * 的写法是这个仓库里最容易写出无限渲染循环的地方。
             */}
            <ValuesCard
              key={`values|${clientKey}|${filePath}|${state.contentHash}`}
              applying={actions.apply.isPending}
              autoFill={state.autoFill}
              changes={changes}
              clientKey={clientKey}
              defaultBaseUrl={defaultBaseUrl}
              defaultModel={BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME}
              detected={state.detected}
              onApply={applyValues}
            />

            <ContentCard saving={actions.save.isPending} state={state} onSave={saveContent} />

            <HistoryCard
              currentHash={state.contentHash}
              loading={versionsLoading}
              onRestore={restoreVersion}
              restoringId={actions.restore.isPending ? (actions.restore.variables?.id ?? null) : null}
              versions={versions}
            />
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}

/** 首屏骨架：两块各给一个同高的占位，避免内容到位时整页跳一下。 */
function CardSkeletons() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}
