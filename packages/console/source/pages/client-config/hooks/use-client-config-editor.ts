import { useRef, useState } from 'react'
import type { ClientConfigFileState, ClientConfigVersionEntry, ClientConfigVersionSummary } from '@common/client-config'
import { agentClientFieldFile, agentClientModelSlots, findAgentClientApplyConfig } from '@common/clients'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import {
  useClientConfigActions,
  useClientConfigFiles,
  useClientConfigPreviews,
  useClientConfigSaveMany,
  useClientConfigVersions,
  useClientConfigVersionsLoading,
} from '@/data/client-config'
import { AGENT_CLIENT_DEFINITION_BY_KEY, type AgentClientEntry } from '@/catalog/clients'
import { formatBytes } from '@/lib/format-bytes'
import type { ClientConfigValues } from '../components/values-card'

/** 一个客户端配置文件在界面上的编辑状态：它此刻的内容，以及是否跟磁盘上的原文不一样。 */
export interface ClientConfigEditorFile {
  /** 注册表里声明的那条 `~/` 路径。 */
  filePath: string
  /** 磁盘上那份文件现在的样子；还没读到是 `null`。 */
  state: ClientConfigFileState | null
  loading: boolean
  error: string | null
  /** 眼下这一份的完整内容（模型选择算出来的预览，或用户手改的文本，或文件原文）。 */
  content: string
  /** 这一份的内容是否跟磁盘上的原文不一样（只读成功后才谈得上「改过」）。 */
  dirty: boolean
}

/** 每个文件一份草稿：两个编辑入口（模型选择与直接改文本）汇到这一份内容上。 */
interface FileDraft {
  values: ClientConfigValues | null
  manual: string | null
}

/**
 * 整个客户端多份文件的编辑状态与动作。
 *
 * 抽出来是因为这套逻辑**详情页与引导页都要用**：详情页把它摆成一整页（页头 + 版本下拉 + 内容模块），
 * 引导页把它嵌进「接入工具」那一步，让用户不必跳到另一页就能改配置。两处共用的是**状态与动作**，
 * 版面各写各的。
 *
 * 客户端由调用方给定（详情页取自路由参数、引导页取自那一步的选择）。一个客户端可能声明多份配置文件：
 * 每份各有一个草稿，内容模块把它们摆成标签，保存一次性写回**所有改动过的文件**——用户改了几份就是几份。
 */
export interface ClientConfigEditor {
  /** 正在编辑的客户端 key（原样回传，供版面拼 `key`、问注册表）。 */
  clientKey: string
  client: AgentClientEntry | undefined
  /** 这个客户端声明的每一份文件，以及它们各自的编辑状态。 */
  files: ClientConfigEditorFile[]
  /** 此刻摊开在内容模块里的是哪一份（标签的值）。 */
  activeFilePath: string
  /** 切换到另一份文件。 */
  selectFile: (filePath: string) => void
  /** 读文件这一步是否还在进行（用来决定首屏骨架）。 */
  loading: boolean
  /** 读文件这一步的失败信息；哪个文件读不出来就是它。 */
  error: string | null
  /** 上方模型选择改了：记下这组值，并丢掉手改的文本。 */
  changeValues: (values: ClientConfigValues) => void
  /** 用户在下方直接改文本；按文件各记各的。 */
  changeContent: (filePath: string, next: string) => void
  /** 把某一份文件的内容改回磁盘上的原文（不影响其余文件）。 */
  discardFile: (filePath: string) => void
  /** 有改动、且没在读、也没在存的文件路径——「保存全部」要写的就是它们。 */
  dirtyFilePaths: string[]
  /** 保存**全部**改动过的文件（各自先备份再落盘）。 */
  saveAll: () => void
  /** 写入进行中。 */
  saving: boolean
  /** 这个客户端有几个可自动写入的模型槽位；0 表示没有配方，不渲染「要写入的值」那张卡。 */
  slots: number
  /** 有没有可自动写入的值（`slots > 0`）。 */
  configurable: boolean
  /** 上面选择的主模型；没有配方、或还没选就是空串。 */
  model: string
  /**
   * 承载模型的配置文件——多文件客户端里那张「要写入的模型」卡只跟它有关，
   * 其余文件没有可选的模型，卡就不渲染。
   */
  valuesFile: ClientConfigEditorFile | undefined
  /**
   * 每次「撤销」自增，作为上方 `ValuesCard` 的 `key` —— 那张卡自己拿着表单 state，
   * 光清草稿它不会动，得让它重挂。
   */
  draftReset: number
  /** 历史版本，供页头那个版本下拉；跟的是当前展开的那份文件。 */
  versions: ClientConfigVersionEntry[]
  versionsLoading: boolean
  /** 回退到某个版本。 */
  restoreVersion: (id: string) => void
  /** 正在回退的版本 id；没有就是 `null`。 */
  restoringId: string | null
}

/**
 * 单个客户端、多份配置文件的编辑状态与动作。
 */
export function useClientConfigEditor(clientKey: string): ClientConfigEditor {
  const t = useTranslation()
  const toast = useToast()
  const client = AGENT_CLIENT_DEFINITION_BY_KEY[clientKey]

  // 客户端声明的全部文件路径。注册表是静态表，这里不必等服务端回话就知道要读哪几份。
  const filePaths = client?.files.map(file => file.path) ?? []

  const [selectedFilePath, setSelectedFilePath] = useState('')
  // 「撤销」要让上方那张表单回神，而表单状态在它自己肚子里：改这个数就是给它一个重挂的理由。
  const [draftReset, setDraftReset] = useState(0)

  // `clientKey` 变了组件并不重挂，`useState` 的初值不会再算一遍：所以「展开的那份文件」只在它确实属于
  // 当前客户端时才作数，否则从 A 的详情走到 B 的详情会拿着 A 的路径去当标签，服务端只会回一句「不在清单里」。
  const activeFilePath = filePaths.includes(selectedFilePath) ? selectedFilePath : filePaths[0] ?? ''

  // 一次把客户端声明的所有文件读回来：切换标签不再各等一次请求，保存全部也才知道要写哪几份。
  const fileEntries = useClientConfigFiles(clientKey, filePaths)

  // 版本下拉跟的是**当前展开的那份文件**：历史永远是「这一份文件」的历史。
  const versions = useClientConfigVersions(clientKey, activeFilePath)
  const versionsLoading = useClientConfigVersionsLoading(clientKey, activeFilePath)
  const actions = useClientConfigActions(clientKey, activeFilePath)
  const saveMany = useClientConfigSaveMany(clientKey)

  /*
   * 草稿按**文件路径**存，用「整套草稿带一个签名」而不是每份各带 key 的 state：保存一次会同时改写
   * 多份文件的 hash，逐个比对不如让整组草稿一起作废——反正保存之后每份都该回到文件原文。
   *
   * 签名取所有文件的「路径 + 内容摘要」拼接：任意一份文件的内容一变（被写、被回退），整组草稿就作废、
   * 按新的现状重建。这也顺手免掉了一个 effect ——「把 props 同步进 state」是这个仓库里最容易写出
   * 无限渲染循环的写法。
   */
  const signature = `${clientKey}|${fileEntries.map(entry => `${entry.filePath}|${entry.state?.contentHash ?? ''}`).join('|')}`
  interface DraftState {
    signature: string
    drafts: Record<string, FileDraft>
    draftReset: number
  }
  const [draft, setDraft] = useState<DraftState>(() => ({ signature, drafts: {}, draftReset: 0 }))
  const fresh: DraftState = draft.signature === signature ? draft : { signature, drafts: {}, draftReset: draft.draftReset }

  /*
   * 改草稿前先把「过期就丢掉」再确认一次：`setDraft` 拿到的是上一次的 state，签名可能还是旧的。
   * 直接 `{ ...prev, ...patch }` 会把过期草稿一起写回去，下一次渲染又判定成「不是当前草稿」，
   * 用户的改动看上去就像没生效。
   */
  const revise = (filePath: string, patch: FileDraft | null) => {
    setDraft(prev => {
      const drafts = { ...(prev.signature === signature ? prev.drafts : {}) }
      if (patch === null) delete drafts[filePath]
      else drafts[filePath] = patch
      return { signature, drafts, draftReset: prev.draftReset }
    })
  }

  const applyConfig = findAgentClientApplyConfig(clientKey)
  const slots = applyConfig ? agentClientModelSlots(applyConfig) : []

  // 模型是客户端级的：任一份文件里选定的模型，对整页生效（改的其实是同一组值）。
  const model = Object.values(fresh.drafts).find(fileDraft => fileDraft.values)?.values?.model ?? ''

  // 值没动过就不问服务端（那就是文件原文，没什么可预览的）。一次问全，返回值与 `filePaths` 一一对应。
  const previews = useClientConfigPreviews(clientKey, filePaths, model !== '' ? { model } : null)

  const files: ClientConfigEditorFile[] = fileEntries.map((entry, index) => {
    const fileDraft = fresh.drafts[entry.filePath]
    const baseContent = entry.state?.content ?? ''
    const preview = previews[index] ?? null
    const content = fileDraft?.manual ?? (fileDraft?.values != null ? preview?.content ?? baseContent : baseContent)
    return {
      filePath: entry.filePath,
      state: entry.state,
      loading: entry.loading,
      error: entry.error,
      content,
      dirty: entry.state !== null && content !== baseContent,
    }
  })

  const loading = fileEntries.length > 0 && fileEntries.some(entry => entry.loading)
  const error = fileEntries.find(entry => entry.error)?.error ?? null
  const dirtyFilePaths = files.filter(file => file.dirty).map(file => file.filePath)

  /*
   * 那张「要写入的模型」卡只在**承载模型的文件**上摆：Claude Code / Pi 之类把模型和凭证分在两个
   * 文件里的客户端，有一个文件根本没有模型可配，摊在它头上只会是一张空卡。承载文件取配方里第一个
   * 有角色的字段所属的那份（`agentClientFieldFile` 与写入端同一条判定）。
   */
  const modelField = applyConfig && client
    ? client.fields.find(field => applyConfig.roles[field.key] !== undefined)
    : undefined
  const valuesFile = modelField && client
    ? files.find(file => file.filePath === agentClientFieldFile(client, modelField))
    : undefined

  // 备份结果要说清「为什么没存」：文件本来不存在，和内容已经在历史里，是两件事。
  // 前者没什么可备份的，后者说明这份内容早就是某个版本了——判断靠写入前的存在性，所以要提前记下来。
  const existedBeforeRef = useRef(false)
  const describeBackup = (backedUp: ClientConfigVersionSummary | null) => {
    if (backedUp) return t('clientConfig.backup.created', { size: formatBytes(backedUp.sizeBytes) })
    return existedBeforeRef.current ? t('clientConfig.backup.existing') : t('clientConfig.backup.skipped')
  }

  /** 换文件只挪标签，不动草稿：改了一半又切回去，那半份改动还在。 */
  const selectFile = (nextPath: string) => setSelectedFilePath(nextPath)

  /** 上方模型改了：记下这组值，并丢掉手改的文本（新的预览就是这段内容的现在）。 */
  const changeValues = (values: ClientConfigValues) => {
    // 模型是客户端级的：一组值同时落到每一份文件上，保存时才不会出现「有的文件写了模型、有的没写」。
    setDraft(() => {
      const drafts: Record<string, FileDraft> = {}
      for (const filePath of filePaths) drafts[filePath] = { values: values.model === '' ? null : values, manual: null }
      return { signature, drafts, draftReset: draftReset }
    })
  }

  /** 用户在下方直接改文本。 */
  const changeContent = (filePath: string, next: string) => {
    revise(filePath, { values: fresh.drafts[filePath]?.values ?? null, manual: next })
  }

  /** 撤销某一份：模型选择与文本一起回到文件里的现状，只退一半就自相矛盾了。 */
  const discardFile = (filePath: string) => {
    revise(filePath, null)
    // 上方那张卡自己拿着一份表单 state（它们才是输入框的真身），光清草稿它不会动，得让它重挂。
    setDraftReset(prev => prev + 1)
  }

  const saveAll = () => {
    const targets = files.filter(file => file.dirty).map(file => ({ filePath: file.filePath, content: file.content }))
    if (targets.length === 0) return
    // 「没得备份」还是「已存在」按写入前的存在性判断——任一份存在过的文件即可代表整次提交的口径。
    existedBeforeRef.current = files.some(file => file.dirty && file.state?.exists)
    saveMany.mutate(
      { files: targets },
      {
        onSuccess: result => {
          if (result.failed.length === 0) {
            toast.success(t('clientConfig.toast.saved'))
            return
          }
          // 有写失败的：能写的已经写了，失败的单独点名，用户知道该回去看哪一份。
          toast.error(t('clientConfig.toast.savePartial', { count: result.failed.length }))
        },
        onError: error => toast.error(error.message),
      },
    )
  }

  const restoreVersion = (id: string) => {
    existedBeforeRef.current = fileEntries.find(entry => entry.filePath === activeFilePath)?.state?.exists ?? false
    actions.restore.mutate(
      { id },
      {
        /*
         * 不用手动清草稿：回退之后 `contentHash` 就变了，签名会替我们把整组草稿拉回文件的新现状。
         */
        onSuccess: result => toast.success(`${t('clientConfig.toast.restored')} ${describeBackup(result.backedUp)}`),
        onError: error => toast.error(error.message),
      },
    )
  }

  return {
    client,
    clientKey,
    files,
    activeFilePath,
    selectFile,
    loading,
    error,
    changeValues,
    changeContent,
    discardFile,
    dirtyFilePaths,
    saveAll,
    saving: saveMany.isPending,
    slots: slots.length,
    configurable: slots.length > 0,
    model,
    valuesFile,
    draftReset,
    versions,
    versionsLoading,
    restoreVersion,
    restoringId: actions.restore.isPending ? (actions.restore.variables?.id ?? null) : null,
  }
}
