import { useState } from 'react'
import { LogicalModelIdSchema } from '@common/schemas'
import { logicalModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

interface CreateLogicalModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function CreateLogicalModelDialog(props: CreateLogicalModelDialogProps) {
  const { open, onOpenChange, onCreated } = props
  const toast = useToast()
  const t = useTranslation()
  const [id, setId] = useState('')
  const [idError, setIdError] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    // 关闭时清掉校验态，避免下次打开残留上一次的报错。
    if (!nextOpen) setIdError('')
    onOpenChange(nextOpen)
  }

  const createLogicalModel = async () => {
    const trimmedId = id.trim()
    const validation = LogicalModelIdSchema.safeParse(trimmedId)
    if (!validation.success) {
      // 就地提示错误，避免只弹 toast 让用户找不到出错的字段。
      // 报错用本地化文案而不是 zod 的原始 message：规则本身写在旁边那行 hint 里，
      // 而 zod 的 message 只有英文一种写法，直接显示会在中文界面上割裂。
      const message = t('logicalModels.create.idInvalid')
      setIdError(message)
      toast.error(message)
      return
    }
    setIdError('')
    setSaving(true)
    try {
      await unwrap(logicalModelApi.create({ id: trimmedId, description: description.trim() }))
      toast.success(t('logicalModels.create.created'))
      setId('')
      setDescription('')
      onOpenChange(false)
      onCreated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('logicalModels.create.title')}</DialogTitle>
          <DialogDescription>{t('logicalModels.create.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField
            label={t('logicalModels.create.idLabel')}
            htmlFor="logical-model-id"
            error={idError}
            required
            hint={t('logicalModels.create.idHint')}
          >
            <Input
              id="logical-model-id"
              value={id}
              aria-invalid={Boolean(idError)}
              onChange={event => { setId(event.target.value); if (idError) setIdError('') }}
              placeholder={t('logicalModels.create.idPlaceholder')}
              autoFocus
            />
          </FormField>
          <FormField label={t('logicalModels.create.descriptionLabel')} htmlFor="logical-model-description">
            <Input
              id="logical-model-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder={t('logicalModels.create.descriptionPlaceholder')}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>{t('common.action.cancel')}</Button>
          <Button disabled={saving} onClick={() => void createLogicalModel()}>{saving ? t('logicalModels.create.submitting') : t('logicalModels.create.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
