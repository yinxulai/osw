import { useRef, useState } from 'react'
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
  useClientConfigPreview,
  useClientConfigVersions,
  useClientConfigVersionsLoading,
} from '@/data/client-config'
import { AGENT_CLIENT_DEFINITION_BY_KEY } from '@/catalog/clients'
import { formatBytes } from '@/lib/format-bytes'
import { routePaths } from '@/routing/routes'
import { CoverageBadge } from './components/coverage-badge'
import { FilePickerBand } from './components/file-picker-band'
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
  // 「撤销」要让上方那张表单回神，而表单状态在它自己肚子里：改这个数就是给它一个重挂的理由。
  const [draftReset, setDraftReset] = useState(0)

  // `$clientKey` 变了组件并不重挂，`useState` 的初值不会再算一遍：所以「选中的文件」只在它确实属于
  // 当前客户端时才作数，否则从 A 的详情走到 B 的详情会拿着 A 的路径去读，服务端只会回一句「不在清单里」。
  const filePath = client !== undefined && client.files.some(file => file.path === selectedFilePath)
    ? selectedFilePath
    : client?.files[0]?.path ?? ''

  const state = useClientConfigFile(clientKey, filePath)
  const status = useClientConfigFileStatus(clientKey, filePath)
  const versions = useClientConfigVersions(clientKey, filePath)
  const versionsLoading = useClientConfigVersionsLoading(clientKey, filePath)
  const actions = useClientConfigActions(clientKey, filePath)
  const fill = useClientConfigFill()

  /*
   * 两块内容都拿这一串当 `key`：文件一变（刚被写、被回退、换了个客户端），表单与草稿就都该按
   * **新的**现状重新初始化。这也顺手免掉了一个 effect —— 那类「把 props 同步进 state」的写法
   * 是这个仓库里最容易写出无限渲染循环的地方。
   */
  const stateKey = `${clientKey}|${filePath}|${state?.contentHash ?? ''}`

  /*
   * 下面这块是**同一份内容的两个编辑入口**共用的草稿。
   *
   * 上方模型选择与下方文本不是两个东西：「把模型换成 X」和「把这段文字改成那样」结果是同一件事，
   * 所以它们汇到一个 `content` 上：
   *
   *   - `values` 是用户在上方选定的模型值（`null` = 没动过，这时内容就是文件原文）；
   *   - `manual` 是用户直接在文本里敲的改动；
   *   - 两者都有时以 `manual` 为准（用户最后动过的是文字），而一旦上方再改一次，
   *     就以那一次为准——预览的意义就是「现在保存会写进去什么」，它必须是当前选择的直接后果。
   *
   * 用「带 key 的 state」而不是 `useEffect` 去重置：`stateKey` 一变这份草稿自然作废，
   * 不需要在 effect 里写一笔「如果换了文件就清空」的同构逻辑。
   */
  interface EditingState {
    key: string
    values: ClientConfigValues | null
    manual: string | null
  }
  const [editing, setEditing] = useState<EditingState>(() => ({ key: stateKey, values: null, manual: null }))
  const current: EditingState = editing.key === stateKey ? editing : { key: stateKey, values: null, manual: null }

  /*
   * 改草稿前先把「过期就丢掉」这件事再确认一次：`setEditing` 拿到的是上一次的 state，
   * 而它可能还挂着旧文件的 key。直接 `{ ...prev, ...patch }` 会把这个过期 key 一起写回去，
   * 下一次渲染又判定成「不是当前草稿」，用户的改动看上去就像没生效。
   */
  const reviseDraft = (prev: EditingState, patch: Partial<Pick<EditingState, 'values' | 'manual'>>): EditingState => ({
    ...(prev.key === stateKey ? prev : { key: stateKey, values: null, manual: null }),
    ...patch,
  })

  // 值没动过就不问服务端（那就是文件原文，没什么可预览的）。
  const preview = useClientConfigPreview(clientKey, filePath, current.values)
  const baseContent = state?.content ?? ''
  const content = current.manual ?? (current.values !== null ? preview?.content ?? baseContent : baseContent)

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

  /*
   * 换文件就丢掉当前的编辑：草稿说的是「这一个文件会变成什么样」，拿着上一个文件的选择继续看
   * 只会得到一句没有意义的预览。真正的重置交给 `stateKey`（新文件的 hash 一定不同）。
   */
  const selectFile = (nextPath: string) => setSelectedFilePath(nextPath)

  /** 上方模型改了：记下这组值，并丢掉手改的文本（新的预览就是这段内容的现在）。 */
  const changeValues = (values: ClientConfigValues) => {
    setEditing(prev => reviseDraft(prev, { values: values.model === '' ? null : values, manual: null }))
  }

  /** 用户在下方直接改文本。 */
  const changeContent = (next: string) => setEditing(prev => reviseDraft(prev, { manual: next }))

  /** 撤销：模型选择与文本一起回到文件里的现状，只退一半就自相矛盾了。 */
  const discardChanges = () => {
    setEditing(prev => reviseDraft(prev, { values: null, manual: null }))
    // 上方那张卡自己拿着一份表单 state（它们才是输入框的真身），光清草稿它不会动，得让它重挂。
    setDraftReset(prev => prev + 1)
  }

  const saveContent = (next: string) => {
    rememberExistence()
    actions.save.mutate(
      { content: next },
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
        /*
         * 不用手动清草稿：回退之后 `contentHash` 就变了，`stateKey` 会替我们把上面的选择与下面的
         * 草稿一起拉回文件的新现状。
         */
        onSuccess: result => toast.success(`${t('clientConfig.toast.restored')} ${describeBackup(result.backedUp)}`),
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
   * 有没有可自动写入的值，由注册表说了算，不必等管理服务回话：配方在静态表里，界面自己就能数出来。
   *
   * `slots.length === 0` 表示这个客户端**真的没有能指向本机服务的东西**（只存模型名，或者地址与
   * provider 定义分在两个文件里）。这种客户端不摆一张空的「要写入的模型」卡：一张只有标题的卡
   * 看着像加载失败，而它既不能解释为什么填不了，也占掉了下面正文的位置。「仅手动」的徽标与
   * 页头那句描述负责说明原因，卡片的缺席本身就是结论。
   */
  const applyConfig = findAgentClientApplyConfig(clientKey)
  const slots = applyConfig ? agentClientModelSlots(applyConfig) : []
  const configurable = slots.length > 0

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
          <CardSkeletons filePicker={client.files.length > 1} slots={slots.length} />
        ) : (
          <>
            {/* 只有多文件客户端才需要这一步；单文件时路径在内容卡片里已经写着。 */}
            {client.files.length > 1 && <FilePickerBand filePath={filePath} files={client.files} onSelectFile={selectFile} />}

            {/* `key` 的来由见上面 `stateKey`：内容一变，表单重新回到文件里的现状。 */}
            {configurable && (
              <ValuesCard
                key={`values|${stateKey}|${draftReset}`}
                autoFill={state.autoFill}
                clientKey={clientKey}
                defaultModel={BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME}
                detected={state.detected}
                onChange={changeValues}
              />
            )}

            {/*
              内容那块不再是「另存一份草稿」：上面改模型与这里改文字编辑的是同一段内容（`content`），
              所以两处共用一套保存/撤销，「写入文件」那一颗因此没有了必要——值一改，这里就跟着变。
            */}
            <ContentCard
              key={`content|${stateKey}`}
              saving={actions.save.isPending}
              state={state}
              value={content}
              onChange={changeContent}
              onDiscard={discardChanges}
              onSave={saveContent}
            />
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
