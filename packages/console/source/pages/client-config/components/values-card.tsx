import { useMemo, useState } from 'react'
import { List, Pencil, SlidersHorizontal } from 'lucide-react'
import type { ClientConfigAutoFill } from '@common/client-config'
import type { AgentClientModelSlot } from '@common/clients'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { agentClientModelSlots, findAgentClientApplyConfig, resolveAgentClientSlotValue } from '@common/clients'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'
import { useLogicalModels } from '@/data/logical-models'

export interface ClientConfigValues {
  model: string
  smallModel: string
}

interface ValuesCardProps {
  clientKey: string
  autoFill: ClientConfigAutoFill
  /** 从文件里回读到的现有值（键是注册表里 `fields[].key`）。 */
  detected: Record<string, string>
  /** 兜底模型名（内置默认逻辑模型），文件里读不到模型时用它。 */
  defaultModel: string
  applying: boolean
  /** 本页最近一次写入实际改了几处；还没写过、或刚换了文件时是 0。 */
  appliedCount: number
  onApply: (values: ClientConfigValues) => void
}

/** 下拉里一条可选的逻辑模型。只取用得到的三个字段，不把整个 `LogicalModel` 拖进这张卡。 */
interface ModelOption {
  id: string
  name: string
  enabled: boolean
}

/**
 * 「要写入的值」。
 *
 * 这一页只让用户决定**模型**：它属于用户自己的取舍。地址与密钥恰好相反——客户端要指向的就是
 * 本机服务本身，那两个值只有一种正确答案，所以既不给输入框也不做展示，直接由服务端写入
 * （见 `ClientConfigApplyRequestSchema`）。需要看那两个值的人去引导页第三步看，那里才是它们该出现的地方。
 *
 * 出现**几行**、每行叫什么、从哪个键回读初值，全部由配方（`AgentClientApplyConfig`）推出来，
 * 不在这里按客户端逐个铺开：Claude Code 那五个写同一个值的模型别名合成一行、只认 `model` 的客户端
 * 就只有一行——它们是同一个事实的两种形态，界面不该自己记一遍。
 *
 * 初值只做**回填**，不替用户拍板模型名：文件里读得到就沿用（用户原来的模型选择必须保住），
 * 读不到才落回内置默认逻辑模型。回填只能靠配方给的声明顺序（`resolveAgentClientSlotValue`）——
 * 「写什么」的权威表在 core 的 `client-config/rules.ts`，控制台不该、也不能反推它。
 */
export function ValuesCard(props: ValuesCardProps) {
  const { clientKey, autoFill, detected, defaultModel, applying, appliedCount, onApply } = props
  const t = useTranslation()
  // 配方是「这几个键一起写」的唯一出处；没有配方时整张卡只读（服务端也不会让它填）。
  const applyConfig = findAgentClientApplyConfig(clientKey)
  const logicalModels = useLogicalModels()
  const ready = autoFill === 'ready'
  const disabled = !ready || applying

  const slots = useMemo(() => (applyConfig ? agentClientModelSlots(applyConfig) : []), [applyConfig])
  const options = useMemo(() => logicalModels.map(model => ({ id: model.id, name: model.name, enabled: model.enabled })), [logicalModels])

  /** 某个槽位在文件里当前的值；没配方就是空串。 */
  const detectedOf = (role: AgentClientModelSlot) => (applyConfig ? resolveAgentClientSlotValue(applyConfig, detected, role) : '')

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    // 小模型不给初值：留空就是「跟随主模型」，替它编一个名字反而是编造。
    for (const role of slots) initial[role] = detectedOf(role) || (role === 'model' ? defaultModel : '')
    return initial
  })

  const setValue = (role: AgentClientModelSlot, next: string) => setValues(current => ({ ...current, [role]: next }))

  // 「还有没有要写的东西」直接用差额回答：表单跟文件一样就没什么可写的，此时按钮只报上一回写了几处。
  const dirty = slots.some(role => (values[role] ?? '') !== detectedOf(role))
  const model = (values.model ?? '').trim()
  const hint = AUTO_FILL_HINT_KEYS[autoFill]

  return (
    <Card>
      {/*
        卡头不报客户端名：页标题、面包屑、「选择配置文件」的下拉里都已经写着它，
        同一屏再说第二遍只是噪音——这张卡要说的事，标题已经说完了。
      */}
      <SettingsCardHeader icon={<SlidersHorizontal />} title={t('clientConfig.step.values')} />

      <CardContent className="px-4">
        <div className="divide-y divide-border/50">
          {slots.map(role => {
            const descriptionKey = SLOT_HINT_KEYS[role]
            return (
              <FormRow
                key={role}
                title={t(SLOT_LABEL_KEYS[role])}
                description={descriptionKey === undefined ? undefined : t(descriptionKey)}
                control={(
                  <ModelField
                    ariaLabel={t(SLOT_LABEL_KEYS[role])}
                    disabled={disabled}
                    options={options}
                    placeholder={t('clientConfig.model.placeholder')}
                    value={values[role] ?? ''}
                    onChange={next => setValue(role, next)}
                  />
                )}
              />
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border/50 py-3">
          <p className="system-xs-regular text-text-tertiary">{t(hint)}</p>
          {/*
            按钮自己就是状态行：表单与文件一致时它没什么可干的，那就把「上一回写了几处」报出来；
            一旦用户改了模型，它就变回一颗可扣的「写入」。上一版把改动清单单铺一块，
            等于用一整行去说一句可以长在按钮上的话。
          */}
          <Button
            disabled={disabled || !dirty || model === ''}
            onClick={() => onApply({ model, smallModel: (values.smallModel ?? '').trim() })}
          >
            {applying ? t('clientConfig.applying') : !dirty && appliedCount > 0 ? t('clientConfig.appliedChanges', { count: appliedCount }) : t('clientConfig.applyValues')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface ModelFieldProps {
  value: string
  onChange: (value: string) => void
  /** 可选的逻辑模型；还没加载出来时是空数组。 */
  options: ModelOption[]
  disabled: boolean
  ariaLabel: string
  placeholder: string
}

/**
 * 一个模型槽位的输入控件。
 *
 * 默认从**逻辑模型**里选：写进配置文件的必须是逻辑模型的名字，引擎就是拿请求里的模型名去
 * `logicalModels[*]` 里找落点的（见 `pages/router/panel/prompt-panel.tsx` 同一套取法）。
 * 右边那枚铅笔换成手动输入，留给「先写个名字、回头再建逻辑模型」的人。
 *
 * 文件里的值不在清单里时（别人手改过、或那个模型已经被删）一进来就是手动模式：
 * 下拉找不到匹配项只会退回占位符，看起来像「什么都没选」，等于把文件里真实写着的值藏起来。
 */
function ModelField(props: ModelFieldProps) {
  const { value, onChange, options, disabled, ariaLabel, placeholder } = props
  const t = useTranslation()
  // `null` = 还没被人为切过，跟着文件里的值走；点过之后以那一下为准。
  const [manual, setManual] = useState<boolean | null>(null)
  const picked = manual ?? (value !== '' && !options.some(option => option.id === value))
  const toggleKey: UiCatalogKey = picked ? 'clientConfig.model.select' : 'clientConfig.model.manual'
  // 清单里没这个名字时，把它自己当成一条选项摆进去：否则用户切回下拉会看到占位符，
  // 像是「什么都没选」，把文件里真实写着的值藏起来。
  const items = value !== '' && !options.some(option => option.id === value)
    ? [{ id: value, name: value, enabled: true }, ...options]
    : options

  return (
    <>
      {picked ? (
        <Input
          aria-label={ariaLabel}
          className="w-80 font-mono"
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      ) : (
        <Select disabled={disabled} value={value === '' ? undefined : value} onValueChange={onChange}>
          <SelectTrigger aria-label={ariaLabel} className="w-80 font-mono">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {items.map(option => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
                {option.name === option.id ? '' : ` · ${option.id}`}
                {option.enabled ? '' : t('clientConfig.model.disabled')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {/* 高度对齐输入框（都是 h-8），否则两行控件的右边界会差一像素。 */}
      <Button
        aria-label={t(toggleKey)}
        disabled={disabled}
        size="icon"
        title={t(toggleKey)}
        variant="ghost"
        onClick={() => setManual(!picked)}
      >
        {picked ? <List /> : <Pencil />}
      </Button>
    </>
  )
}

const AUTO_FILL_HINT_KEYS: Record<ClientConfigAutoFill, UiCatalogKey> = {
  ready: 'clientConfig.autoFill.ready',
  unparsable: 'clientConfig.autoFill.unparsable',
  'unsupported-format': 'clientConfig.autoFill.unsupportedFormat',
  'unsupported-client': 'clientConfig.autoFill.unsupportedClient',
}

/** 槽位在表单上的行标题。 */
const SLOT_LABEL_KEYS: Record<AgentClientModelSlot, UiCatalogKey> = {
  model: 'clientConfig.label.model',
  smallModel: 'clientConfig.label.smallModel',
}

/** 槽位在表单上的补充说明；没有就只留标题。 */
const SLOT_HINT_KEYS: Partial<Record<AgentClientModelSlot, UiCatalogKey>> = {
  smallModel: 'clientConfig.hint.smallModel',
}
