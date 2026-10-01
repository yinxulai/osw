import { useRef, useState } from 'react'
import type { ClientConfigFileState, ClientConfigVersionEntry, ClientConfigVersionSummary } from '@common/client-config'
import { agentClientModelSlots, findAgentClientApplyConfig } from '@common/clients'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import {
  useClientConfigActions,
  useClientConfigFile,
  useClientConfigFileStatus,
  useClientConfigPreview,
  useClientConfigVersions,
  useClientConfigVersionsLoading,
} from '@/data/client-config'
import { AGENT_CLIENT_DEFINITION_BY_KEY, type AgentClientEntry } from '@/catalog/clients'
import { formatBytes } from '@/lib/format-bytes'
import type { ClientConfigValues } from '../components/values-card'

/** 一个客户端配置文件的编辑状态；「同一条内容有两个编辑入口」那套草稿逻辑都收在这里。 */
export interface ClientConfigEditor {
  /** 正在编辑的客户端 key（原样回传，供版面拼 `key`、问注册表）。 */
  clientKey: string
  client: AgentClientEntry | undefined
  /** 此刻在编辑哪一份文件。多文件客户端才有得选，单文件就是它唯一的那份。 */
  filePath: string
  /** 换一份文件来编。 */
  selectFile: (filePath: string) => void
  /**
   * 这份文件此刻的草稿标识（客户端 + 路径 + 内容摘要）。任何一个变了，草稿与表单都该按新的现状重来；
   * 版面把这个串拼进 `key` 里，就能用「带 key 的 state」代替一个把 props 同步进 state 的 effect。
   */
  stateKey: string
  /** 磁盘上那份文件现在的样子；还没读到是 `null`。 */
  state: ClientConfigFileState | null
  status: { loading: boolean; error: string | null }
  /** 眼下这一稿的完整内容（模型选择算出来的预览，或用户手改的文本，或文件原文）。 */
  content: string
  /** 上方模型选择改了：记下这组值，并丢掉手改的文本。 */
  changeValues: (values: ClientConfigValues) => void
  /** 用户在下方直接改文本。 */
  changeContent: (next: string) => void
  /** 丢弃全部改动，回到磁盘上的原文。 */
  discardChanges: () => void
  /** 把这一稿写回文件（先备份、再落盘）。 */
  saveContent: (next: string) => void
  /** 写入进行中。 */
  saving: boolean
  /**
   * 每次「撤销」自增，作为上方 `ValuesCard` 的 `key` —— 那张卡自己拿着表单 state，
   * 光清草稿它不会动，得让它重挂。
   */
  draftReset: number
  /** 这个客户端有几个可自动写入的模型槽位；0 表示没有配方，不渲染「要写入的值」那张卡。 */
  slots: number
  /** 有没有可自动写入的值（`slots > 0`）。 */
  configurable: boolean
  /** 历史版本，供页头那个版本下拉。 */
  versions: ClientConfigVersionEntry[]
  versionsLoading: boolean
  /** 回退到某个版本。 */
  restoreVersion: (id: string) => void
  /** 正在回退的版本 id；没有就是 `null`。 */
  restoringId: string | null
}

/**
 * 单个客户端配置文件的编辑状态与动作。
 *
 * 抽出来是因为这套「同一份内容的两个编辑入口汇到一个草稿」的逻辑，**详情页与引导页都要用**：
 * 详情页把它摆成一整页（页头 + 版本下拉 + 三块内容），引导页把它嵌进「接入工具」那一步，
 * 让用户不必跳到另一页就能改配置。两处共用的是**状态与动作**，版面各写各的。
 *
 * 客户端由调用方给定（详情页取自路由参数、引导页取自那一步的选择）；文件在客户端声明的那几份
 * 里选，默认第一份。
 */
export function useClientConfigEditor(clientKey: string): ClientConfigEditor {
  const t = useTranslation()
  const toast = useToast()
  const client = AGENT_CLIENT_DEFINITION_BY_KEY[clientKey]

  const [selectedFilePath, setSelectedFilePath] = useState('')
  // 「撤销」要让上方那张表单回神，而表单状态在它自己肚子里：改这个数就是给它一个重挂的理由。
  const [draftReset, setDraftReset] = useState(0)

  // `clientKey` 变了组件并不重挂，`useState` 的初值不会再算一遍：所以「选中的文件」只在它确实属于
  // 当前客户端时才作数，否则从 A 的详情走到 B 的详情会拿着 A 的路径去读，服务端只会回一句「不在清单里」。
  const filePath = client !== undefined && client.files.some(file => file.path === selectedFilePath)
    ? selectedFilePath
    : client?.files[0]?.path ?? ''

  const state = useClientConfigFile(clientKey, filePath)
  const status = useClientConfigFileStatus(clientKey, filePath)
  const versions = useClientConfigVersions(clientKey, filePath)
  const versionsLoading = useClientConfigVersionsLoading(clientKey, filePath)
  const actions = useClientConfigActions(clientKey, filePath)

  /*
   * 两处草稿都拿这一串当 `key`：文件一变（刚被写、被回退、换了个客户端），表单与草稿就都该按
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

  return {
    client,
    clientKey,
    filePath,
    selectFile,
    stateKey,
    state,
    status,
    content,
    changeValues,
    changeContent,
    discardChanges,
    saveContent,
    saving: actions.save.isPending,
    draftReset,
    slots: slots.length,
    configurable: slots.length > 0,
    versions,
    versionsLoading,
    restoreVersion,
    restoringId: actions.restore.isPending ? (actions.restore.variables?.id ?? null) : null,
  }
}
