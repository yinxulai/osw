import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { FORM_DIALOG_BODY_CLASSNAME, FormField, FormSwitchRow } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import type { ApiKeyDraft } from '../lib/draft'

interface ApiKeyDialogProps {
  open: boolean
  /** 有 id 表示编辑已有 Key，否则是新建。 */
  editingId: string | null
  draft: ApiKeyDraft
  saving: boolean
  onChange: (draft: ApiKeyDraft) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}

/**
 * 新建 / 编辑对话框。
 *
 * 编辑时不提供「查看明文」——列表数据里没有明文，服务端也不回显。想换密钥就走轮换，
 * 这件事在页面上是独立入口，不藏进编辑框里，因为两者改的不是同一件事
 * （编辑改元数据、轮换改密钥）。
 */
export function ApiKeyDialog(props: ApiKeyDialogProps) {
  const t = useTranslation()
  const { draft, onChange } = props
  const [touched, setTouched] = useState(false)

  useEffect(() => { if (props.open) setTouched(false) }, [props.open])

  const nameError = touched && draft.name.trim().length === 0 ? t('apiKeys.form.name') : undefined

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{props.editingId ? t('apiKeys.dialog.editTitle') : t('apiKeys.dialog.createTitle')}</DialogTitle>
          <DialogDescription>{t('apiKeys.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className={FORM_DIALOG_BODY_CLASSNAME}>
          <FormField label={t('apiKeys.form.name')} htmlFor="api-key-name" required error={nameError}>
            <Input
              id="api-key-name"
              value={draft.name}
              maxLength={100}
              placeholder={t('apiKeys.form.namePlaceholder')}
              onChange={event => onChange({ ...draft, name: event.target.value })}
            />
          </FormField>

          <FormField label={t('apiKeys.form.expires')} htmlFor="api-key-expires" hint={t('apiKeys.form.expiresHint')}>
            <Input
              id="api-key-expires"
              type="date"
              value={draft.expiresDate}
              onChange={event => onChange({ ...draft, expiresDate: event.target.value })}
            />
          </FormField>

          <FormSwitchRow
            label={t('apiKeys.form.enabled')}
            description={t('apiKeys.form.enabledHint')}
            checked={draft.enabled}
            onCheckedChange={enabled => onChange({ ...draft, enabled })}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>{t('common.action.cancel')}</Button>
          <Button
            disabled={props.saving || draft.name.trim().length === 0}
            onClick={() => { setTouched(true); props.onSubmit() }}
          >
            {props.saving ? t('common.action.saving') : t('apiKeys.action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
