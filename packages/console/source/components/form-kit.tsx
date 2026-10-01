import type { ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * 全应用统一的表单基元，视觉与 `pages/router/panel/panel-fields.tsx` 的节点配置面板保持一致：
 * 13px 次级色标签、控件承载视觉、模块用「白底 + 模块边框」分隔而不是灰底。
 * 控件本身（Input / Textarea / Select）的 token 已固化在 `components/ui/*` 里，这里只负责排版与语义。
 */

export type FormOption = {
  value: string
  label: ReactNode
  disabled?: boolean
}

/** 表单类弹窗正文的滚动容器，统一最大高度与内边距。 */
export const FORM_DIALOG_BODY_CLASSNAME = 'max-h-[65vh] space-y-4 overflow-y-auto px-1 py-2'

type FormHintProps = {
  children: ReactNode
  tone?: 'muted' | 'warning' | 'destructive'
  className?: string
}

/** 字段说明 / 校验提示。 */
export function FormHint(props: FormHintProps) {
  const { children, tone = 'muted', className } = props

  return (
    <p
      className={cn(
        'system-xs-regular',
        tone === 'warning' && 'text-text-warning',
        tone === 'destructive' && 'text-text-destructive',
        tone === 'muted' && 'text-text-tertiary',
        className,
      )}
    >
      {children}
    </p>
  )
}

type FormFieldProps = {
  label: ReactNode
  children: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  className?: string
}

/** 「标签 + 控件 + 说明」的纵向字段组，是全应用表单的最小单元。 */
export function FormField(props: FormFieldProps) {
  const { label, children, htmlFor, hint, error, required, className } = props

  return (
    <div className={cn('grid gap-1.5', className)}>
      <label className="w-fit py-1 system-sm-medium text-text-secondary" htmlFor={htmlFor}>
        {label}
        {required && <span className="text-text-destructive"> *</span>}
      </label>
      {children}
      {error ? <FormHint tone="destructive">{error}</FormHint> : hint ? <FormHint>{hint}</FormHint> : null}
    </div>
  )
}

type FormGridProps = {
  children: ReactNode
  columns?: 1 | 2 | 3 | 4
  className?: string
}

const GRID_COLUMN_CLASSNAME: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
}

/** 字段网格，统一断点与间距。 */
export function FormGrid(props: FormGridProps) {
  const { children, columns = 2, className } = props

  return <div className={cn('grid gap-4', GRID_COLUMN_CLASSNAME[columns], className)}>{children}</div>
}

type FormGroupProps = {
  children: ReactNode
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  id?: string
  className?: string
}

/** 表单里的分组：只提供标题层级，不额外加底色，适合包裹已有卡片/区块。 */
export function FormGroup(props: FormGroupProps) {
  const { children, title, description, action, id, className } = props

  return (
    <div className={cn('grid gap-3', className)} id={id}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <div className="system-sm-medium text-text-primary">{title}</div>}
            {description && <p className="mt-0.5 system-xs-regular text-text-tertiary">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

type FormSectionProps = {
  children: ReactNode
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  id?: string
  className?: string
}

/** 分组区块：白底 + 模块边框，把整个分组圈成一个可识别的模块。 */
export function FormSection(props: FormSectionProps) {
  const { children, title, description, action, id, className } = props

  return (
    <FormGroup
      action={action}
      className={cn('rounded-lg border border-module-border bg-card p-4', className)}
      description={description}
      id={id}
      title={title}
    >
      {children}
    </FormGroup>
  )
}

type FormRowProps = {
  title: ReactNode
  description?: ReactNode
  /** 右侧控件；不传就是一条纯说明行（只有标题与说明，右端留空）。 */
  control?: ReactNode
  error?: ReactNode
  className?: string
}

/**
 * 横向设置行：左侧标题说明，右侧控件。
 * 设置项一律不带图标——图标只出现在卡片头，行内保持朴素，避免和正文抢视觉。
 */
export function FormRow(props: FormRowProps) {
  const { title, description, control, error, className } = props

  return (
    <div className={cn('flex min-h-14 items-center justify-between gap-4 py-3', className)}>
      <div className="min-w-0">
        <div className="system-sm-medium text-text-primary">{title}</div>
        {description && <p className="mt-0.5 system-xs-regular text-text-tertiary">{description}</p>}
        {error && <p className="mt-0.5 system-xs-regular text-text-destructive">{error}</p>}
      </div>
      {control ? <div className="flex shrink-0 items-center gap-2">{control}</div> : null}
    </div>
  )
}

type FormSwitchRowProps = {
  label: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  description?: ReactNode
  disabled?: boolean
  className?: string
}

/** 开关行：标签在左、Switch 在右；可带说明。 */
export function FormSwitchRow(props: FormSwitchRowProps) {
  const { label, checked, onCheckedChange, description, disabled, className } = props

  return (
    <FormRow
      className={className}
      title={label}
      description={description}
      control={<Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />}
    />
  )
}

type FormSelectProps = {
  value: string
  onValueChange: (value: string) => void
  options: FormOption[]
  id?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

/** 受控下拉：统一触发器宽度与浮层样式，避免每个表单各写一遍 Select 组合。 */
export function FormSelect(props: FormSelectProps) {
  const { value, onValueChange, options, id, placeholder, disabled, className, ariaLabel } = props

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel} className={cn('w-full', className)} id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
