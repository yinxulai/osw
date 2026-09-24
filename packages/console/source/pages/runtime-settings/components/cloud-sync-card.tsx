import { useState } from 'react'
import type { CloudBackupKind } from '@common/cloud-backup'
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Cloud, ExternalLink, Link2, Loader2, PlugZap, XCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormHint, FormRow, FormSelect, type FormOption } from '@/components/form-kit'
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
  const [credentialInput, setCredentialInput] = useState('')
  const [targetInput, setTargetInput] = useState('')

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

  return (
    <Card>
      <SettingsCardHeader
        icon={<Cloud />}
        title={t('settings.cloudSync.title')}
        description={t('settings.cloudSync.description')}
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
                  void sync.selectProvider(value as CloudBackupKind)
                }}
              />
            )}
          />

          <FormRow
            title={text(descriptor.credential.labelKey)}
            description={status.credentialConfigured
              ? status.accountLabel
                ? t('settings.cloudSync.credentialConnected', { account: status.accountLabel })
                : t('settings.cloudSync.credentialMissing')
              : text(descriptor.credential.hintKey)}
            control={(
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
                  onClick={() => { void sync.saveCredential(credentialInput).then(saved => { if (saved) setCredentialInput('') }) }}
                >
                  <PlugZap className="size-3.5" />
                  {t('settings.cloudSync.credentialSave')}
                </Button>
                {status.credentialConfigured && (
                  <Button variant="ghost" className="shrink-0" disabled={busy} onClick={() => void sync.clearCredential()}>
                    {t('settings.cloudSync.credentialClear')}
                  </Button>
                )}
              </>
            )}
          />

          <FormRow
            title={text(descriptor.target.labelKey)}
            description={status.target
              ? t('settings.cloudSync.targetBound', { target: status.target })
              : text(descriptor.target.hintKey)}
            control={(
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
                  onClick={() => { void sync.bindTarget(targetInput).then(bound => { if (bound) setTargetInput('') }) }}
                >
                  <Link2 className="size-3.5" />
                  {t('settings.cloudSync.targetBind')}
                </Button>
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
              </>
            )}
          />

          <FormRow
            title={t('settings.cloudSync.transferLabel')}
            description={status.lastPushedTime === 0 && status.lastPulledTime === 0
              ? t('settings.cloudSync.neverSynced')
              : t('settings.cloudSync.lastSynced', {
                  uploaded: formatTime(status.lastPushedTime, t('settings.cloudSync.timeNever')),
                  downloaded: formatTime(status.lastPulledTime, t('settings.cloudSync.timeNever')),
                })}
            control={(
              <>
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={busy || !status.credentialConfigured}
                  title={credentialReason ?? actionTitle}
                  onClick={() => void sync.push()}
                >
                  {sync.pending === 'push' ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpFromLine className="size-3.5" />}
                  {t('settings.cloudSync.uploadAction')}
                </Button>
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={busy || !status.credentialConfigured || !status.target}
                  title={credentialReason ?? targetReason ?? actionTitle}
                  onClick={() => void sync.pull()}
                >
                  {sync.pending === 'pull' ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowDownToLine className="size-3.5" />}
                  {t('settings.cloudSync.downloadAction')}
                </Button>
              </>
            )}
          />
        </div>

        {/* 这条不是提示而是告知：密钥确实会一起上传，而且只是编码。不写出来就是在用户不知情时把密钥推出去。 */}
        <FormHint className="pt-3">{t('settings.cloudSync.secretsNotice')}</FormHint>

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
