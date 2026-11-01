import * as React from 'react'
import { Check, ChevronDown, Code, Copy, Download, LoaderCircle, Terminal, Upload } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { buildCurl } from '../lib/build-curl'
import { buildFetch } from '../lib/build-fetch'
import type { RequestCommandInput } from '../lib/request-command'

export interface RequestContentsActionsProps {
  /** 客户端原始请求；`null` 表示代理地址未知或报文还没到，这条命令不成立。 */
  clientInput: RequestCommandInput | null
  /** 真正发往供应商的那次请求；`null` 表示没有发出过请求或正文还没到。 */
  upstreamInput: RequestCommandInput | null
  /** 客户端报文本身在不在；用来区分「没有正文」与「地址未知」两种不可用原因。 */
  hasClientContent: boolean
  /** 下载错误报告；`null` 表示没有选中的尝试，没有可导出的现场。 */
  onDownloadReport: (() => void) | null
  /** 报告正在组装。 */
  reportPending: boolean
}

/** 菜单里的三档目标：客户端 cURL / 客户端 fetch / 上游 cURL / 上游 fetch。 */
const COPY_TARGETS = {
  'client-curl': buildCurl,
  'client-fetch': buildFetch,
  'upstream-curl': buildCurl,
  'upstream-fetch': buildFetch,
} as const

type CopyTarget = keyof typeof COPY_TARGETS

/**
 * 正文面板自己的「复制请求」入口。
 *
 * 面板里说的「请求」有两份，问答不同：**客户端原始请求**是我们收到了什么，
 * **发往供应商的请求**是供应商收到了什么。复现失败现场要的是后者——
 * 它带着改写与协议转换之后的头与正文，地址也是那次尝试真实的绝对 URL。
 * 两档都放在这里，而不是让用户自己从两个阶段里各复制一段再拼。
 *
 * 菜单而不是一颗按钮：cURL / fetch × 客户端 / 上游 一共四种组合，
 * 把最常用的客户端 cURL 留给按钮本身、其余收进菜单，按钮就不必随数据有无变形。
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

  const inputOf = (target: CopyTarget) => target.startsWith('upstream') ? props.upstreamInput : props.clientInput

  const copyAs = async (target: CopyTarget) => {
    const input = inputOf(target)
    if (input === null) return
    setPending(true)
    try {
      await navigator.clipboard.writeText(COPY_TARGETS[target](input))
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.action.copyFailed'))
    } finally {
      setPending(false)
    }
  }

  const upstreamAvailable = props.upstreamInput !== null
  // 两种「不可用」原因不同，说法必须不同：没采到正文 vs 地址拼不出来。
  const clientUnavailable = props.clientInput === null
    ? (props.hasClientContent ? t('requestLogs.detail.copyRequestNoOrigin') : t('requestLogs.detail.copyRequestUnavailable'))
    : null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="inline-flex items-stretch">
        {/* 主按钮就是最常用的一档，点一次就拿到命令；其余三种收在右侧菜单里。 */}
        <MenuButton
          onClick={() => void copyAs('client-curl')}
          disabled={props.clientInput === null || pending}
          title={clientUnavailable ?? t('requestLogs.detail.copyRequestTitle')}
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
          <DropdownMenuContent align="start" sideOffset={6} className="w-64">
            <DropdownMenuItem disabled={props.clientInput === null} onSelect={() => void copyAs('client-curl')} className="gap-2">
              <Terminal size={14} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t('requestLogs.detail.copyAsCurl')}</span>
              {/* 主按钮就是这一档，菜单里写明，免得两条入口看起来做的事不一样。 */}
              <span className="shrink-0 font-mono system-2xs-regular text-text-quaternary">
                {t('requestLogs.detail.copyAsDefault')}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={props.clientInput === null} onSelect={() => void copyAs('client-fetch')} className="gap-2">
              <Code size={14} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t('requestLogs.detail.copyAsFetch')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-components-panel-border" />
            {/* 上游视角单独一组：它回答的是另一个问题，不能和上面两条混成同义项。 */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={!upstreamAvailable}
                title={upstreamAvailable
                  ? t('requestLogs.detail.copyUpstreamRequest')
                  : t('requestLogs.detail.copyUpstreamUnavailable')}
                className="gap-2"
              >
                <Upload size={14} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t('requestLogs.detail.copyUpstreamRequest')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => void copyAs('upstream-curl')} className="gap-2">
                  <Terminal size={14} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t('requestLogs.detail.copyAsCurl')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyAs('upstream-fetch')} className="gap-2">
                  <Code size={14} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t('requestLogs.detail.copyAsFetch')}</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
