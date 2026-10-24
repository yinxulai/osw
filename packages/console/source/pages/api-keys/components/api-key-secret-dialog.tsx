import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/copy-button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useTranslation } from '@/i18n/provider'

interface ApiKeySecretDialogProps {
  open: boolean
  /** 标题里的 Key 名；创建与轮换共用同一个对话框。 */
  name: string
  secret: string
  /** 轮换与创建各自的标题措辞不同，由调用方挑一个。 */
  rotated: boolean
  onClose: () => void
}

/**
 * 明文展示弹窗——**只出现一次**。
 *
 * 关闭之后服务端再也拿不到这份明文（它在宿主的密钥存储里，接口不回显），
 * 所以关掉之前必须让用户明确意识到「现在不抄就没有了」：警示条 + 复制按钮 + 唯一的关闭入口。
 * 这是整个页面唯一一个带破坏性语义的「关闭」动作（关掉 = 丢失），所以措辞上点明后果。
 */
export function ApiKeySecretDialog(props: ApiKeySecretDialogProps) {
  const t = useTranslation()
  const { copiedKey, copy } = useCopyToClipboard()

  return (
    <Dialog open={props.open} onOpenChange={open => !open && props.onClose()}>
      <DialogContent className="sm:max-w-lg" onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{props.rotated ? t('apiKeys.secret.rotatedTitle', { name: props.name }) : t('apiKeys.secret.title', { name: props.name })}</DialogTitle>
          <DialogDescription>{t('apiKeys.secret.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-lg border border-module-border bg-inset px-3 py-2">
          <ShieldCheck className="size-3.5 shrink-0 text-info" aria-hidden />
          <code className="min-w-0 flex-1 break-all font-mono system-xs-regular text-text-primary">{props.secret}</code>
          <CopyButton
            itemKey="secret"
            value={props.secret}
            copiedKey={copiedKey}
            onCopy={copy}
            label={t('apiKeys.secret.copy')}
          />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/8 px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-text-warning" aria-hidden />
          <p className="system-xs-regular text-text-warning">{t('apiKeys.secret.warning')}</p>
        </div>

        <DialogFooter>
          <Button onClick={props.onClose}>{t('apiKeys.secret.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
