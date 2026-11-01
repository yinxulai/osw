import * as React from 'react'
import { Check, ChevronDown, Code, Copy, Download, LoaderCircle, Terminal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { buildCurl } from '../lib/build-curl'
import { buildFetch } from '../lib/build-fetch'
import type { RequestCommandInput } from '../lib/request-command'

export interface RequestContentsActionsProps {
  /** 这次尝试真正发出去的那份请求；`null` 表示没采到正文，这条命令不成立。 */
  upstreamInput: RequestCommandInput | null
  /** 下载错误报告；`null` 表示没有选中的尝试，没有可导出的现场。 */
  onDownloadReport: (() => void) | null
  /** 报告正在组装。 */
  reportPending: boolean
}

/** 菜单里的两档目标语言。 */
const COPY_TARGETS = {
  curl: buildCurl,
  fetch: buildFetch,
} as const

type CopyTarget = keyof typeof COPY_TARGETS

/**
 * 正文面板自己的「复制请求」入口。
 *
 * 面板永远是**一次具体尝试**的现场，因此这里的「请求」只有一份：代理在那一刻真正发出去的
 * 报文——地址是尝试自己记下的绝对 URL，头与正文是协议转换与改写之后的结果。
 * 客户端发来的原件在面板里已经能逐段查看，行上也有它自己的复制入口，标题栏不再重复提供一次；
 * 两份并列还会逼出「发往供应商的请求」这种绕口的名字：对着一份具体报文说它要去哪，是废话。
 *
 * 菜单而不是两颗按钮：cURL 是绝大多数场景要的，留给按钮本身；fetch 收在菜单里，
 * 按钮就不必随数据有无变形。
 */
export function RequestContentsActions(props: RequestContentsActionsProps) {
  const t = useTranslation()
  const toast = useToast()
  const [copied, setCopied] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const copyAs = async (target: CopyTarget) => {
    if (props.upstreamInput === null) return
    setPending(true)
    try {
      await navigator.clipboard.writeText(COPY_TARGETS[target](props.upstreamInput))
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.action.copyFailed'))
    } finally {
      setPending(false)
    }
  }

  // 只有一种「不可用」：这次尝试没有采到发出去的报文。原因写在提示里，不另设文案分支。
  const available = props.upstreamInput !== null

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-1.5">
      <div className="inline-flex items-stretch">
        {/* 主按钮就是最常用的一档，点一次就拿到命令；fetch 收在右侧菜单里。 */}
        <MenuButton
          onClick={() => void copyAs('curl')}
          disabled={!available || pending}
          title={available ? t('requestLogs.contents.copyRequestTitle') : t('requestLogs.contents.copyRequestUnavailable')}
          className="rounded-r-none border-r-0"
        >
          {pending
            ? <LoaderCircle size={12} aria-hidden className="animate-spin" />
            : copied
              ? <Check size={12} aria-hidden />
              : <Copy size={12} aria-hidden />}
          {copied ? t('common.action.copied') : t('requestLogs.detail.copyRequest')}
        </MenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('requestLogs.detail.copyRequestMenuTitle')}
              title={t('requestLogs.detail.copyRequestMenuTitle')}
              className="inline-flex items-center justify-center rounded-r-md border border-module-border px-1 py-1 text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              <ChevronDown size={12} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          {/* 动作组固定在面板底部，菜单往上开：往下会盖住正文的工具栏与搜索框。 */}
          <DropdownMenuContent align="end" side="top" sideOffset={6} className="w-56">
            <DropdownMenuItem disabled={!available} onSelect={() => void copyAs('curl')} className="gap-2">
              <Terminal size={14} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t('requestLogs.detail.copyAsCurl')}</span>
              {/* 主按钮就是这一档，菜单里写明，免得两条入口看起来做的事不一样。 */}
              <span className="shrink-0 font-mono system-2xs-regular text-text-quaternary">
                {t('requestLogs.detail.copyAsDefault')}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!available} onSelect={() => void copyAs('fetch')} className="gap-2">
              <Code size={14} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t('requestLogs.detail.copyAsFetch')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {props.onDownloadReport && (
        <button
          type="button"
          title={t('requestLogs.detail.downloadErrorReportTitle')}
          disabled={props.reportPending}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-module-border px-2 py-1 system-2xs-medium text-text-secondary transition-colors hover:bg-state-base-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:opacity-50"
          onClick={props.onDownloadReport}
        >
          {props.reportPending
            ? <LoaderCircle size={12} aria-hidden className="animate-spin" />
            : <Download size={12} aria-hidden />}
          {t('requestLogs.detail.downloadErrorReport')}
        </button>
      )}
    </div>
  )
}

interface MenuButtonProps {
  disabled: boolean
  title: string
  className?: string
  onClick: () => void
  children: React.ReactNode
}

/** 与标题栏其它按钮同一套尺寸与描边；只有圆角被拆成左半边，因为右边接菜单触发器。 */
function MenuButton(props: MenuButtonProps) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-module-border px-2 py-1 system-2xs-medium text-text-secondary transition-colors hover:bg-state-base-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:opacity-50',
        props.className,
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
