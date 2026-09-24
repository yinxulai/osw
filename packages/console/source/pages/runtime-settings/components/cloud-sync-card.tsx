import { useState } from 'react'
import type { CloudBackupKind } from '@common/cloud-backup'
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Cloud, ExternalLink, Link2, Loader2, PlugZap, XCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow, FormSelect, type FormOption } from '@/components/form-kit'
import { tryTranslate } from '@/i18n/active'
import { getPlatformCapabilities } from '@/platform/capabilities'
import { useTranslation } from '@/i18n/provider'
import { useCloudSync } from '../hooks/use-cloud-sync'

/**
 * 设置页里的「配置云同步」。
 *
 * **不进设置草稿**：凭据是密钥（不落数据库）、远端绑定与两个时间戳都由服务端写回，
 * 把它们混进「改完再一起保存」的草稿里，就会出现「界面显示已绑定、服务端还不知道」这类
 * 谁都不想要的状态。所以这一张卡自己收自己的状态，每一行都是一按即写。
 *
 * **界面不认识任何具体后端**：标题、占位符、行内说明都来自当前承载方式自述里给的 key，
 * 后端列表也由状态带回。加一种承载方式（WebDAV、对象存储……）只需要在服务端注册，
 * 这一张卡一个字都不用改。
 */
export function CloudSyncCard() {
  const sync = useCloudSync()
  const t = useTranslation()
  const confirm = useConfirm()
  const [credentialInput, setCredentialInput] = useState('')
  const [targetInput, setTargetInput] = useState('')
  // 已连接 / 已绑定的行默认收起输入框：一个空输入框摆在「已连接为 @x」旁边，
  // 谁也说不清它是要改、还是没填完。要改再点「更换」，输入框才出来。
  const [editingCredential, setEditingCredential] = useState(false)
  const [editingTarget, setEditingTarget] = useState(false)

  const status = sync.status
  const descriptor = sync.descriptor
  const busy = sync.busy

  // 状态与后端自述是同一次请求回来的，缺一个就没法渲染：等它们，而不是先画一半再补。
  if (!status || !descriptor) {
    return (
      <Card className="min-h-36 p-4">
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="mb-5 h-3 w-52" />
        <Skeleton className="h-9 w-full" />
      </Card>
    )
  }

  /** 承载方式自述里给的是 key，翻不到就退回 key 本身：至少能看出是哪一个后端缺文案。 */
  const text = (key: string): string => tryTranslate(key) ?? key

  const providerOptions: FormOption[] = status.providers.map(item => ({ value: item.kind, label: text(item.labelKey) }))

  const actionTitle = t('settings.cloudSync.transferDescription')
  // 上传要凭据；拉取还要一个已绑定的远端（没绑定时上传会顺手建一个，所以提示的是上传）。
  const credentialReason = status.credentialConfigured ? undefined : t('settings.cloudSync.credentialRequired')
  const targetReason = status.target
    ? undefined
    : descriptor.createsTarget ? t('settings.cloudSync.targetRequiredAuto') : t('settings.cloudSync.targetRequired')
  // 备份没绑定也能做（后端可以顺手建一个），恢复则必须有确切的来源。
  const canPush = status.credentialConfigured && (Boolean(status.target) || descriptor.createsTarget)
  const canPull = status.credentialConfigured && Boolean(status.target)

  /** 恢复会整份盖掉本机的供应商、模型与绑定，盖完没法撤销：先问一句再动手。 */
  const handleRestore = async (): Promise<void> => {
    const confirmed = await confirm({
      title: t('settings.cloudSync.restoreConfirmTitle'),
      description: t('settings.cloudSync.restoreConfirmDescription'),
      confirmLabel: t('settings.cloudSync.downloadAction'),
      variant: 'destructive',
    })
    if (confirmed) await sync.pull()
  }

  return (
    <Card>
      <SettingsCardHeader
        icon={<Cloud />}
        title={t('settings.cloudSync.title')}
        description={t('settings.cloudSync.description')}
        actions={(
          <Badge variant={status.credentialConfigured ? 'success' : 'muted'}>
            {status.credentialConfigured ? t('settings.cloudSync.statusConnected') : t('settings.cloudSync.statusDisconnected')}
          </Badge>
        )}
      />
      <CardContent className="px-4">
        <div className="divide-y divide-border/50">
          <FormRow
            title={t('settings.cloudSync.providerLabel')}
            description={t('settings.cloudSync.providerHint')}
            control={(
              <FormSelect
                ariaLabel={t('settings.cloudSync.providerAria')}
                className="w-64"
                disabled={busy}
                options={providerOptions}
                value={status.provider}
                onValueChange={value => {
                  // 换后端后，输入框里那半截旧后端的凭据/句柄没有任何意义，先清掉。
                  setCredentialInput('')
                  setTargetInput('')
                  setEditingCredential(false)
                  setEditingTarget(false)
                  void sync.selectProvider(value as CloudBackupKind)
                }}
              />
            )}
          />

          {/* 未连接（或正在更换）才是输入框；连上之后这一行只报告「连成了谁」，
              想换再点「更换」。这样摆着空输入框的歧义（要填？要改？）就没了。 */}
          <FormRow
            title={text(descriptor.credential.labelKey)}
            description={status.credentialConfigured && !editingCredential
              ? status.accountLabel
                ? t('settings.cloudSync.credentialConnected', { account: status.accountLabel })
                : t('settings.cloudSync.credentialMissing')
              : text(descriptor.credential.hintKey)}
            control={status.credentialConfigured && !editingCredential ? (
              <>
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => { setEditingCredential(true); setCredentialInput('') }}
                >
                  {t('settings.cloudSync.credentialChange')}
                </Button>
                <Button
                  variant="ghost"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => { void sync.clearCredential().then(() => setEditingCredential(false)) }}
                >
                  {t('settings.cloudSync.credentialClear')}
                </Button>
              </>
            ) : (
              <>
                <Input
                  type="password"
                  aria-label={text(descriptor.credential.labelKey)}
                  className="w-64 font-mono"
                  value={credentialInput}
                  onChange={event => setCredentialInput(event.target.value)}
                  placeholder={text(descriptor.credential.placeholderKey)}
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={busy || credentialInput.trim().length === 0}
                  onClick={() => { void sync.saveCredential(credentialInput).then(saved => { if (saved) { setCredentialInput(''); setEditingCredential(false) } }) }}
                >
                  <PlugZap className="size-3.5" />
                  {t(status.credentialConfigured ? 'settings.cloudSync.credentialSave' : 'settings.cloudSync.credentialConnect')}
                </Button>
                {status.credentialConfigured && (
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => { setEditingCredential(false); setCredentialInput('') }}
                  >
                    {t('common.confirm.cancelLabel')}
                  </Button>
                )}
              </>
            )}
          />

          {/* 与凭据行同一套规则：绑好了就只显示绑在哪儿，输入框收起来。 */}
          <FormRow
            title={text(descriptor.target.labelKey)}
            description={status.target && !editingTarget
              ? t('settings.cloudSync.targetBound', { target: status.target })
              : text(descriptor.target.hintKey)}
            control={status.target && !editingTarget ? (
              <>
                {status.targetUrl && (
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    aria-label={t('settings.cloudSync.targetOpen')}
                    onClick={() => getPlatformCapabilities().openExternal(status.targetUrl)}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => { setEditingTarget(true); setTargetInput(status.target) }}
                >
                  {t('settings.cloudSync.targetChange')}
                </Button>
                <Button
                  variant="ghost"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => { void sync.bindTarget('').then(bound => { if (bound) { setEditingTarget(false); setTargetInput('') } }) }}
                >
                  {t('settings.cloudSync.targetUnbind')}
                </Button>
              </>
            ) : (
              <>
                <Input
                  aria-label={text(descriptor.target.labelKey)}
                  className="w-64 font-mono"
                  value={targetInput}
                  onChange={event => setTargetInput(event.target.value)}
                  placeholder={text(descriptor.target.placeholderKey)}
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={busy || targetInput.trim().length === 0}
                  onClick={() => { void sync.bindTarget(targetInput).then(bound => { if (bound) { setTargetInput(''); setEditingTarget(false) } }) }}
                >
                  <Link2 className="size-3.5" />
                  {t('settings.cloudSync.targetBind')}
                </Button>
                {status.target && (
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => { setEditingTarget(false); setTargetInput('') }}
                  >
                    {t('common.confirm.cancelLabel')}
                  </Button>
                )}
              </>
            )}
          />

          <FormRow
            title={t('settings.cloudSync.transferLabel')}
            description={t('settings.cloudSync.lastSynced', {
              uploaded: formatTime(status.lastPushedTime, t('settings.cloudSync.timeNever')),
              downloaded: formatTime(status.lastPulledTime, t('settings.cloudSync.timeNever')),
            })}
            control={(
              <>
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={busy || !canPush}
                  title={credentialReason ?? targetReason ?? actionTitle}
                  onClick={() => void sync.push()}
                >
                  {sync.pending === 'push' ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpFromLine className="size-3.5" />}
                  {status.target || !descriptor.createsTarget
                    ? t('settings.cloudSync.uploadAction')
                    : t('settings.cloudSync.uploadCreateAction')}
                </Button>
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={busy || !canPull}
                  title={credentialReason ?? targetReason ?? actionTitle}
                  onClick={() => void handleRestore()}
                >
                  {sync.pending === 'pull' ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowDownToLine className="size-3.5" />}
                  {t('settings.cloudSync.downloadAction')}
                </Button>
              </>
            )}
          />
        </div>

        {sync.message && (
          <Alert className="mt-1 mb-1 border-0 bg-success/10 text-text-success">
            <CheckCircle2 />
            <AlertDescription className="text-current">{sync.message}</AlertDescription>
          </Alert>
        )}
        {sync.errorMessage && (
          <Alert variant="destructive" className="mt-1 mb-1 border-0 bg-destructive/10">
            <XCircle />
            <AlertDescription>{sync.errorMessage}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

/** 时间戳只做本地展示；没有同步过就交给目录里的「从未」，而不是自己拼一个空字符串。 */
function formatTime(value: number, never: string): string {
  if (value === 0) return never
  return new Date(value).toLocaleString()
}
