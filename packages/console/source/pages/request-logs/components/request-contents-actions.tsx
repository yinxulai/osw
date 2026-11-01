import * as React from 'react'
import { Check, ChevronDown, Code, Copy, Download, LoaderCircle, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
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
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      {/* 分裂按钮交给 `ButtonGroup`：它负责把两片的接缝收掉、圆角只留在最外侧，
          而不是像以前那样靠手写 `border-r-0` 去碰两个各自带描边的盒子。 */}
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          className={copied ? 'text-text-success' : undefined}
          title={available ? t('requestLogs.contents.copyRequestTitle') : t('requestLogs.contents.copyRequestUnavailable')}
          disabled={!available || pending}
          onClick={() => void copyAs('curl')}
        >
          {pending
            ? <LoaderCircle aria-hidden className="animate-spin" />
            : copied
              ? <Check aria-hidden />
              : <Copy aria-hidden />}
          {copied ? t('common.action.copied') : t('requestLogs.detail.copyRequest')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t('requestLogs.detail.copyRequestMenuTitle')}
              title={t('requestLogs.detail.copyRequestMenuTitle')}
            >
              <ChevronDown aria-hidden />
            </Button>
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
      </ButtonGroup>
      {props.onDownloadReport && (
        <Button
          variant="outline"
          size="sm"
          title={t('requestLogs.detail.downloadErrorReportTitle')}
          disabled={props.reportPending}
          onClick={props.onDownloadReport}
        >
          {props.reportPending
            ? <LoaderCircle aria-hidden className="animate-spin" />
            : <Download aria-hidden />}
          {t('requestLogs.detail.downloadErrorReport')}
        </Button>
      )}
    </div>
  )
}


