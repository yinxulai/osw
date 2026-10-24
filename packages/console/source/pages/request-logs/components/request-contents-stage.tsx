import * as React from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import type { ContentSearchResult, SectionHighlight } from '../lib/content-search'
import type { ContentStage } from '../lib/contents'
import { formatContent } from '../lib/format-content'

export interface CopyButtonProps {
  value: string
  /** 可访问名，例如「复制请求 Body」。 */
  label: string
  className?: string
}

/**
 * 复制按钮。
 *
 * 每个内容块自带一个，只复制该块展示出来的文本：用户看到什么就拿到什么，
 * 不需要自己去拼上下文。复制成功的反馈放在按钮上，不再弹 toast 干扰排障视线。
 */
export function CopyButton(props: CopyButtonProps) {
  const t = useTranslation()
  const toast = useToast()
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.action.copyFailed'))
    }
  }

  return (
    <button
      type="button"
      aria-label={copied ? t('common.action.copied') : props.label}
      title={copied ? t('common.action.copied') : props.label}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        copied && 'text-text-success',
        props.className,
      )}
      onClick={event => {
        // 这个按钮可能与可折叠标题相邻，避免顺带触发展开 / 收起。
        event.stopPropagation()
        void copy()
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

/**
 * 正文占位。
 *
 * 不在外面套 `bg-inset` 凹槽：骨架条自己就是 `bg-inset`，套进去亮色下就看不见了
 * （一条嵌套链只允许一层凹槽，见设计令牌笔记）。
 */
function ContentSkeleton() {
  return (
    <div aria-hidden className="space-y-2 px-3 pb-3.5">
      <Skeleton className="h-3 w-3/5" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-2/5" />
    </div>
  )
}

interface ContentSectionProps {
  id: string
  label: string
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 命中高亮；没有搜索词时为 `null`，此时整段按普通文本渲染。 */
  highlight: SectionHighlight | null
  /** 当前激活的命中序号（全局），用于定位与强调。 */
  activeMatchIndex: number | null
  /**
   * 正文还在路上。
   *
   * 这一节该存在、该叫什么，都写在「报文摘要」里（摘要随详情一起到），只有正文那几列要现取，
   * 所以加载时不该让整块内容消失——标题照常画出来，正文位置放骨架。
   */
  loading: boolean
}

function ContentSection(props: ContentSectionProps) {
  const t = useTranslation()
  const content = formatContent(t, props.value)
  const segments = props.highlight?.segments ?? [{ text: content.value, matchIndex: null }]
  const matchCount = props.highlight?.count ?? 0

  // 内容块自身不再给底色：它已经是「阶段外壳」里的一个分节，再套一层白底
  // 就会在白色 Sheet 上变成看不见的白块。分节靠外壳的 border 与父级 divide-y 划分，
  // 整条链路只保留代码正文这一层凹槽（bg-inset）。
  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      {/* 标题行拆成「折叠触发器 + 复制按钮」两个兄弟节点：按钮嵌在按钮里不合法，
          而拆开后拖动复制不会顺带折叠这块正文。 */}
      <div className="flex items-center transition-colors hover:bg-state-base-hover">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left system-xs-medium text-text-primary">
          <span className="truncate">{props.label}</span>
          {!props.loading && content.isJson && <span className="shrink-0 rounded-md bg-inset px-1.5 py-0.5 font-mono system-2xs-regular text-text-tertiary">JSON</span>}
          {!props.loading && matchCount > 0 && (
            <span className="shrink-0 rounded-md bg-amber-300/70 px-1.5 py-0.5 font-mono system-2xs-regular text-text-primary dark:bg-amber-400/25">
              {t('requestLogs.contents.matchCount', { count: matchCount })}
            </span>
          )}
          <ChevronDown size={15} aria-hidden className={cn('ml-auto shrink-0 text-text-quaternary transition-transform', !props.open && '-rotate-90')} />
        </CollapsibleTrigger>
        {/* 正文没到就没有可复制的东西，不给一个只会复制出空字符串的按钮。 */}
        {!props.loading && <CopyButton className="mr-1.5" label={t('requestLogs.contents.copyLabel', { label: props.label })} value={content.value} />}
      </div>
      <CollapsibleContent>
        {props.loading
          ? <ContentSkeleton />
          : (
            <pre className="mx-3 mb-3 whitespace-pre-wrap break-all rounded-md bg-inset p-3 font-mono text-xs leading-5 text-text-secondary">
              {segments.map((segment, index) => segment.matchIndex === null
                ? <React.Fragment key={index}>{segment.text}</React.Fragment>
                : (
                  <mark
                    key={index}
                    data-search-match={segment.matchIndex}
                    className={cn(
                      'rounded-sm',
                      segment.matchIndex === props.activeMatchIndex
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-amber-300/70 text-text-primary dark:bg-amber-400/30',
                    )}
                  >
                    {segment.text}
                  </mark>
                ))}
            </pre>
          )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * 一个阶段（客户端原始请求 / 发往上游的请求 / 上游响应 / 返回客户端的响应）。
 *
 * 数据部分（标题、协议、状态、分节）由 `lib/contents.ts` 决定；这里只决定怎么画，
 * 以及展开态从哪来——展开态是渲染态，留在宿主里（见 `RequestContentsSheet`）。
 */
export interface RequestStageProps extends ContentStage {
  open: boolean
  onOpenChange: (open: boolean) => void
  sectionStates: Record<string, boolean>
  onSectionOpenChange: (id: string, open: boolean) => void
  search: ContentSearchResult
  /** 当前激活的命中序号（全局）；没有搜索词时为 `null`。 */
  activeMatchIndex: number | null
  /** 正文还在路上：阶段外壳照常画，正文位置放骨架。 */
  loading: boolean
  /**
   * 正文整体缺失（被保留策略清掉，或采集开关当时是关的）。
   *
   * 此时四个阶段全部没有任何可展示的正文。不再整块隐藏——那会让人以为界面坏了，
   * 而且和「有正文的请求」长得完全不一样；改成照旧画出来，里面用 `—` 占位。
   */
  empty: boolean
}

export function RequestStage(props: RequestStageProps) {
  const t = useTranslation()
  const sections = props.sections.filter(section => section.value)
  // 正文整体缺失时仍然把阶段画出来（见 `empty`），其余情况没有内容就不占版面。
  // 加载中也不能提前 return：那时每一节的正文都还是 `null`，一 return 整块就「还没到就先消失」。
  if (sections.length === 0 && !props.empty && !props.loading) return null
  // 加载中每一节都要画，正文位置换成骨架；这就把「这一节存在、叫什么」与「正文到没到」拆开了。
  const renderedSections = props.loading ? props.sections : sections

  // 阶段是这条链路上唯一的一层「外壳」：只留边框，不再铺灰底。
  // 铺灰底会和 Sheet 的 bg-background 形成交替填充，
  // 而白 100% 与灰 92% 只差 8 点明度，边界几乎看不见，整屏就糊成一片。
  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      <section className="overflow-hidden rounded-lg border border-module-border">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left system-sm-medium text-text-primary transition-colors hover:bg-state-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-state-accent-solid">
          <ChevronDown
            size={14}
            aria-hidden
            className={cn('shrink-0 text-text-quaternary transition-transform', !props.open && '-rotate-90')}
          />
          <span>{props.title}</span>
          <span className="font-mono system-xs-regular text-text-tertiary">· {props.protocol}</span>
          {(props.statusLabel || props.partialCapture) && (
            /* 两个尾部徽标合成一个右对齐组：状态码并不是总有（如上游一个字节都没回），
               各自带 `ml-auto` 会让「谁在右边」随数据有无而变。 */
            <div className="ml-auto flex items-center gap-1.5">
              {props.statusLabel && (
                <span className="rounded-md bg-inset px-1.5 py-0.5 font-mono system-2xs-regular text-text-tertiary">
                  {props.statusLabel}
                </span>
              )}
              {props.partialCapture && (
                /* 徽标本身就是悬停靶点：不再另加一个 info 图标——多一个图标反而要人先猜到它能点。 */
                <Tooltip>
                  <TooltipTrigger className="rounded-md bg-warning/10 px-1.5 py-0.5 system-2xs-medium text-text-warning transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid">
                    {t('requestLogs.contents.capture.partial')}
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('requestLogs.contents.capture.partialHint')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y divide-border/50 border-t border-border/50">
            {sections.length === 0 && !props.loading
              ? props.sections.map(section => (
                <div key={section.id} className="flex items-center gap-2 px-3 py-2.5 system-xs-regular">
                  <span className="text-text-tertiary">{section.label}</span>
                  <span className="ml-auto font-mono text-text-quaternary">—</span>
                </div>
              ))
              : renderedSections.map(section => (
                <ContentSection
                  key={section.id}
                  id={section.id}
                  label={section.label}
                  value={section.value ?? ''}
                  open={props.sectionStates[section.id] ?? true}
                  onOpenChange={open => props.onSectionOpenChange(section.id, open)}
                  highlight={props.search.highlights.get(section.id) ?? null}
                  activeMatchIndex={props.activeMatchIndex}
                  loading={props.loading}
                />
              ))}
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}
