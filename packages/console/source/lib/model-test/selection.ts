import type { Translator } from '@common/i18n'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { CONVERTIBLE_PROTOCOLS, PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import type { Protocol, Provider, ProviderModelRoute } from '@common/schemas'

/**
 * 诊断面板的**选择模型**：哪些协议可测、哪些被勾上、这一批要跑哪些任务。
 *
 * 这里只有纯函数，没有 React。理由是这些判断全都是「规则」——协议能不能测由端点的
 * `protocolConversionEnabled` 与 `CONVERTIBLE_PROTOCOLS` 决定，勾选态由协议逐个求和
 * 决定——规则不该长在渲染文件里，否则验证「一个只开了 completions 的模型可测三个协议」
 * 就得先挂一棵组件树。
 *
 * 所有 `prune*` / `toggle*` 都遵守同一条约定：**没有实际变化就返回原引用**。
 * 面板的父级每 10s / 30s 会重建模型与供应商数组，每次返回新 Set / 新对象都等于把
 * 「重渲染 → 重跑 effect → 写 state → 再重渲染」这条空转链装回去。
 */

/** 模型 id → 已勾选的协议。没有键表示「没显式选过」，由默认值（全部可测协议）决定。 */
export type ModelProtocolSelection = Record<string, Set<Protocol>>

/** 一个模型身上**全部**可测协议：原生支持的，加上端点打开了转换后能转过去的。 */
export function getTestableProtocols(model: ProviderModelRoute): Protocol[] {
  const protocols = new Set(model.endpoints.map(endpoint => endpoint.protocol))
  for (const endpoint of model.endpoints) {
    if (!endpoint.protocolConversionEnabled) continue
    for (const protocol of CONVERTIBLE_PROTOCOLS[endpoint.protocol]) protocols.add(protocol)
  }
  return [...protocols]
}

/**
 * 这个协议是不是**转出来的**：模型自己没有它，但某个端点开了转换且能转过去。
 *
 * 与「可测」分开的原因是可测是并集、这个是差集：一个协议既可测又可能是原生的，
 * 界面上前者决定有没有这一格，后者决定这一格要不要标黄。
 */
export function supportsConvertedProtocol(model: ProviderModelRoute, protocol: Protocol): boolean {
  return !model.endpoints.some(endpoint => endpoint.protocol === protocol)
    && model.endpoints.some(endpoint => endpoint.protocolConversionEnabled && CONVERTIBLE_PROTOCOLS[endpoint.protocol].includes(protocol))
}

export interface ProtocolSegmentState {
  converted: boolean
  selected: boolean
}

/** 协议分段的三种长相：选中抬起、未选中只给文字、转换加 Warning 色。 */
export function getProtocolSegmentClassName(state: ProtocolSegmentState): string {
  if (state.converted) {
    return state.selected
      ? 'bg-warning/15 text-text-warning'
      : 'text-text-warning hover:bg-warning/10'
  }
  if (state.selected) return 'bg-card text-text-primary'
  return 'text-text-tertiary hover:bg-state-base-hover hover:text-text-primary'
}

export interface ProtocolSegmentLabelOptions {
  converted: boolean
  protocol: Protocol
  t: Translator<UiCatalogKey>
}

/** 分段的无障碍名：转换出来的那一格要把「会被改写」说出来，而不只是换个颜色。 */
export function getProtocolSegmentLabel(options: ProtocolSegmentLabelOptions): string {
  const label = PROTOCOL_DISPLAY_NAMES[options.protocol]
  return options.converted ? options.t('protocol.conversion.aria', { protocol: label }) : label
}

/**
 * 模型 / 供应商集合变化后校正已勾选的协议。
 *
 * 只保留仍然可测的协议（转换开关关掉之后，转出来的那个协议就不该继续被勾着）；
 * 已经不在 `enabledModels` 里的模型整条丢掉。
 *
 * 没有显式选择的模型**不落条目**：`current[model.id] ?? []` 那样存回去，等于给每个模型
 * materialize 一个空集；而待测计划的默认值是「没存过就全部可测协议」
 * （`modelProtocols[id] ?? getTestableProtocols(model)`）。空集不是「没存过」，它绕过了
 * 那个默认值——于是所有模型的协议被清空、待测计划归零、「开始诊断」永久变灰，点它毫无反应。
 * 触发条件并不罕见：依赖里带着 `enabledModels`，而模型列表每 30 秒轮询一次（引用每次都新）；
 * StrictMode 更直接——挂载后立刻把 effect 再跑一遍，面板一打开就中招。
 *
 * 「用户主动取消了全部协议」是另一回事：那时 `previous` 存在（就是空集），该保留，
 * 所以按「有没有条目」区分，而不是按「是不是空集」区分。
 */
export function pruneModelProtocolSelection(models: readonly ProviderModelRoute[], current: ModelProtocolSelection): ModelProtocolSelection {
  let changed = false
  const next: ModelProtocolSelection = {}
  for (const model of models) {
    const previous = current[model.id]
    if (!previous) continue
    const kept = new Set([...previous].filter(protocol => getTestableProtocols(model).includes(protocol)))
    // `kept` 是 `previous` 的子集，长度相同就意味着一个都没被剔掉，可以沿用原 Set 引用。
    if (kept.size === previous.size) next[model.id] = previous
    else {
      next[model.id] = kept
      changed = true
    }
  }
  if (Object.keys(next).length !== Object.keys(current).length) changed = true
  return changed ? next : current
}

/** 供应商被删 / 被停用之后，把已勾选的供应商收敛到还存在的那些。 */
export function pruneProviderSelection(providers: readonly Provider[], current: Set<string>): Set<string> {
  const next = new Set([...current].filter(providerId => providers.some(provider => provider.id === providerId)))
  return next.size === current.size ? current : next
}

export function toggleProviderSelection(current: ReadonlySet<string>, providerId: string): Set<string> {
  const next = new Set(current)
  if (next.has(providerId)) next.delete(providerId)
  else next.add(providerId)
  return next
}

/**
 * 切换单个协议。
 *
 * 起点必须是**行上显示的那个默认**（全部可测协议），不能是空集：面板刚打开时没有任何
 * 显式选择，而模型行已经把三个分段都画成选中、右侧也写着 `3/3 协议`；此时从空集开始
 * 就差一个，第一下点击会静默地把另外两个一起取消——显示与实际各说一套。
 */
export function toggleProtocolSelection(models: readonly ProviderModelRoute[], current: ModelProtocolSelection, modelId: string, protocol: Protocol): ModelProtocolSelection {
  const model = models.find(item => item.id === modelId)
  const selectedProtocols = new Set(current[modelId] ?? (model ? getTestableProtocols(model) : []))
  if (selectedProtocols.has(protocol)) selectedProtocols.delete(protocol)
  else selectedProtocols.add(protocol)
  return { ...current, [modelId]: selectedProtocols }
}

/**
 * 一次开关一个模型的全部可测协议。
 *
 * 满选 / 部分选都归到同一个动作上：满选就清空、其余情况补满——半选时用户的本意
 * 基本都是「我要这个模型的全部」，而不是「再点一下变成空的」。
 * 模型走的是完整模型列表而不是某个视图，所以搜索词不影响它勾到几个协议。
 */
export function toggleModelSelection(models: readonly ProviderModelRoute[], current: ModelProtocolSelection, modelId: string): ModelProtocolSelection {
  const model = models.find(item => item.id === modelId)
  if (!model) return current
  const protocols = getTestableProtocols(model)
  const selectedProtocols = current[modelId] ?? new Set(protocols)
  const fullySelected = protocols.length > 0 && protocols.every(protocol => selectedProtocols.has(protocol))
  return { ...current, [modelId]: new Set(fullySelected ? [] : protocols) }
}

/** 每个模型的每个可测协议都被勾上、且所属供应商也勾着，才算「全选」。 */
export function isEveryTaskSelected(models: readonly ProviderModelRoute[], providerIds: ReadonlySet<string>, modelProtocols: ModelProtocolSelection): boolean {
  return models.length > 0
    && models.every(model => providerIds.has(model.providerId)
      && getTestableProtocols(model).every(protocol => modelProtocols[model.id]?.has(protocol)))
}

export interface TestSelection {
  providerIds: Set<string>
  modelProtocols: ModelProtocolSelection
}

/** 全选：所有可见供应商 + 每个模型的全部可测协议。 */
export function selectEveryTask(models: readonly ProviderModelRoute[], providers: readonly Provider[]): TestSelection {
  return {
    providerIds: new Set(providers.map(provider => provider.id)),
    modelProtocols: Object.fromEntries(models.map(model => [model.id, new Set(getTestableProtocols(model))])),
  }
}

/**
 * 取消全选：清空供应商，并且给每个模型写一个**空集**。
 *
 * 空集要显式写进去，不能靠 `delete` 回到「没选过」：没选过的默认值是全部可测协议，
 * 删键等于把刚取消的全选又变回全选。
 */
export function clearAllTasks(models: readonly ProviderModelRoute[]): TestSelection {
  return {
    providerIds: new Set(),
    modelProtocols: Object.fromEntries(models.map(model => [model.id, new Set<Protocol>()])),
  }
}

export interface ProtocolOptionView {
  protocol: Protocol
  converted: boolean
  selected: boolean
  title: string
}

export interface ModelOptionView {
  model: ProviderModelRoute
  selectedCount: number
  selected: boolean
  indeterminate: boolean
  protocols: ProtocolOptionView[]
}

export interface ProviderOptionView {
  provider: Provider
  selected: boolean
  /** 这个渠道下已勾选了至少一个协议的模型数（不是模型总数）。 */
  selectedCount: number
  models: ModelOptionView[]
}

export interface SelectionViewOptions {
  providers: readonly Provider[]
  models: readonly ProviderModelRoute[]
  providerIds: ReadonlySet<string>
  modelProtocols: ModelProtocolSelection
  query: string
  t: Translator<UiCatalogKey>
}

/**
 * 左栏的视图模型：按渠道分组、套用搜索词、算好行级三态与计数。
 *
 * 搜索词同时匹配渠道名与模型名（搜渠道时它下面那几行都留下），大小写与前后空格都先
 * 归一；没有命中任何模型的渠道整组不渲染——留一个空壳分组只会占掉半屏。
 */
export function buildSelectionView(options: SelectionViewOptions): ProviderOptionView[] {
  const normalizedQuery = options.query.trim().toLocaleLowerCase()
  return options.providers.map(provider => {
    const selected = options.providerIds.has(provider.id)
    const models = options.models
      .filter(model => model.providerId === provider.id)
      .filter(model => !normalizedQuery
        || provider.name.toLocaleLowerCase().includes(normalizedQuery)
        || model.modelName.toLocaleLowerCase().includes(normalizedQuery))
      .map(model => {
        const protocols = getTestableProtocols(model)
        const selectedProtocols = options.modelProtocols[model.id] ?? new Set(protocols)
        const selectedCount = protocols.filter(protocol => selectedProtocols.has(protocol)).length
        return {
          model,
          selectedCount,
          /*
           * 「整行」的勾选态由协议逐个求和得来，不另存一份。
           * 一份状态两处表达，迟早会出现「行说全选、药丸只剩两个」的对不上。
           */
          selected: protocols.length > 0 && selectedCount === protocols.length,
          indeterminate: selectedCount > 0 && selectedCount < protocols.length,
          protocols: protocols.map(protocol => {
            const converted = supportsConvertedProtocol(model, protocol)
            return {
              protocol,
              converted,
              selected: selectedProtocols.has(protocol),
              title: getProtocolSegmentLabel({ converted, protocol, t: options.t }),
            }
          }),
        }
      })
    return {
      provider,
      selected,
      models,
      selectedCount: models.filter(model => model.selectedCount > 0).length,
    }
  }).filter(view => view.models.length > 0)
}
