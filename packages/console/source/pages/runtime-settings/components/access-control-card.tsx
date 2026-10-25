import { useState } from 'react'
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { MANAGEMENT_PASSWORD_MIN_LENGTH } from '@common/auth'
import type { ManagementUser } from '@common/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow, FormSwitchRow } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import { useAccountManagement } from '../hooks/use-account-management'

interface AccessControlCardProps {
  /** 走设置草稿：「要求登录」是一项设置，和别的设置一起保存。 */
  enabled: boolean
  onEnabledChange: (value: boolean) => void
}

/**
 * 设置页的「访问控制」：要不要登录，以及谁能登录。
 *
 * ## 为什么开关在草稿里，账号列表不在
 *
 * 开关是一项**设置**，保存按钮统一提交；账号是**数据**，建一个就该立刻生效。把两者
 * 放进同一条「改完再一起保存」的路，会让「我已经建好账号了」和「服务端其实还没有」
 * 同时成立于界面上，而后者正好会让这台服务处于没人能登进去的状态。
 *
 * ## 桌面用户也能开
 *
 * 一开始只有服务器形态需要它，但这个开关对桌面用户同样有意义：面板能改配置、能导出
 * 明文密钥，一台共享的电脑上把它关掉就等于把这些能力交给任何路过的人。所以这里不判断
 * 宿主形态——服务端的默认值已经按监听地址算过一次（见 `runtime/server-runtime.ts`），
 * 界面只提供「用户的选择」。
 *
 * ## 关掉时不禁用账号区
 *
 * 关掉开关之后账号仍然在库里，只是不再被要求。禁用整个账号区会让人以为账号被删了，
 * 而重新打开开关时又会发现有账号——两件事都不需要用户猜。
 */
export function AccessControlCard(props: AccessControlCardProps) {
  const { enabled, onEnabledChange } = props
  const t = useTranslation()
  const confirm = useConfirm()
  const accounts = useAccountManagement()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // 改口令**不用确认框**：`useConfirm` 只回一个是/否，问不出一串口令来。为它加一个
  // 「带输入的确认框」等于把两件事（确认 + 表单）塞进同一个组件；就地展开一个输入框
  // 反而更直白：点「改口令」→ 行内长出输入框 → 回车提交。
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingPassword, setEditingPassword] = useState('')

  const canCreate = username.trim().length > 0 && password.length >= MANAGEMENT_PASSWORD_MIN_LENGTH

  const handleCreate = () => {
    if (!canCreate || accounts.create.isPending) return
    accounts.create.mutate(
      { username: username.trim(), password },
      {
        onSuccess: () => {
          setUsername('')
          setPassword('')
        },
      },
    )
  }

  const handleChangePassword = (account: ManagementUser) => {
    if (editingPassword.length < MANAGEMENT_PASSWORD_MIN_LENGTH || accounts.changePassword.isPending) return
    accounts.changePassword.mutate(
      { id: account.id, password: editingPassword },
      {
        onSuccess: () => {
          setEditingId(null)
          setEditingPassword('')
        },
      },
    )
  }

  const handleRemove = async (account: ManagementUser) => {
    const approved = await confirm({
      title: t('settings.auth.removeTitle', { username: account.username }),
      description: t('settings.auth.removeDescription'),
      confirmLabel: t('common.action.delete'),
      variant: 'destructive',
    })
    if (!approved) return
    accounts.remove.mutate({ id: account.id })
  }

  return (
    <Card data-screenshot="access-control">
      <SettingsCardHeader
        icon={<ShieldCheck />}
        title={t('settings.auth.title')}
        description={t('settings.auth.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormSwitchRow
          label={t('settings.auth.enabled')}
          description={t('settings.auth.enabledDescription')}
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />

        {/*
         * 没有账号时**照样渲染账户区**，只是列表那一行变成一句说明。整块消失会让人以为
         * 「这里没有账号功能」，而此刻恰恰是最该建第一个账号的时候。
         */}
        {accounts.loading ? (
          <FormRow
            title={t('settings.auth.accounts')}
            control={<Skeleton className="h-4 w-24" />}
          />
        ) : accounts.accounts.length === 0 ? (
          <FormRow
            title={t('settings.auth.accounts')}
            description={t('settings.auth.empty')}
          />
        ) : (
          accounts.accounts.map(account => (
            <FormRow
              key={account.id}
              title={account.username}
              description={
                account.lastLoginTime === null
                  ? t('settings.auth.neverLoggedIn')
                  : t('settings.auth.lastLogin', { time: new Date(account.lastLoginTime).toLocaleString() })
              }
              control={editingId === account.id ? (
                <>
                  <Input
                    aria-label={t('settings.auth.passwordPlaceholder')}
                    className="w-44"
                    placeholder={t('settings.auth.passwordPlaceholder')}
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    value={editingPassword}
                    onChange={event => setEditingPassword(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') handleChangePassword(account)
                      if (event.key === 'Escape') { setEditingId(null); setEditingPassword('') }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={editingPassword.length < MANAGEMENT_PASSWORD_MIN_LENGTH || accounts.changePassword.isPending}
                    onClick={() => handleChangePassword(account)}
                  >
                    {t('settings.action.save')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setEditingId(null); setEditingPassword('') }}
                  >
                    {t('common.action.cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setEditingId(account.id); setEditingPassword('') }}
                  >
                    <KeyRound />
                    {t('settings.auth.changePassword')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('settings.auth.remove')}
                    disabled={accounts.accounts.length <= 1 || accounts.remove.isPending}
                    onClick={() => void handleRemove(account)}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            />
          ))
        )}

        {/*
         * 新建账号行常驻：它是最要紧的一条（没有账号时开关开了也进不去），所以不做
         * 「点加号才出现输入框」的折叠。
         */}
        <FormRow
          title={t('settings.auth.addTitle')}
          description={t('settings.auth.addDescription', { minimum: MANAGEMENT_PASSWORD_MIN_LENGTH })}
          control={(
            <>
              <Input
                aria-label={t('settings.auth.usernamePlaceholder')}
                className="w-32"
                placeholder={t('settings.auth.usernamePlaceholder')}
                value={username}
                onChange={event => setUsername(event.target.value)}
              />
              <Input
                aria-label={t('settings.auth.passwordPlaceholder')}
                className="w-44"
                placeholder={t('settings.auth.passwordPlaceholder')}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
              <Button size="sm" disabled={!canCreate || accounts.create.isPending} onClick={handleCreate}>
                {t('settings.auth.addAction')}
              </Button>
            </>
          )}
        />
      </CardContent>
    </Card>
  )
}
