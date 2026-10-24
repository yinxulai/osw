import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { buildCreateLogicalModelInput, validateLogicalModelId } from '../lib/logical-model-form'
import { createLogicalModel } from '../lib/logical-model-writes'

interface CreateLogicalModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

/**
 * 新建逻辑模型的对话框。
 *
 * 它只持有「用户正在填什么」这一份草稿状态；能不能填、填完发什么请求，都由
 * `lib/logical-model-form` 与 `lib/logical-model-writes` 决定。这里不做业务判断，
 * 也不认识 API 的形状。
 */
export function CreateLogicalModelDialog(props: CreateLogicalModelDialogProps) {
  const { open, onOpenChange, onCreated } = props
  const toast = useToast()
  const t = useTranslation()
  const [modelId, setModelId] = useState('')
  const [idError, setIdError] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    // 关闭时清掉校验态，避免下次打开残留上一次的报错。
    if (!nextOpen) setIdError('')
    onOpenChange(nextOpen)
  }

  const submit = async () => {
    const issue = validateLogicalModelId(modelId)
    if (issue) {
      // 就地提示错误，避免只弹 toast 让用户找不到出错的字段。
      // 报错用本地化文案而不是 zod 的原始 message：规则本身写在旁边那行 hint 里，
      // 而 zod 的 message 只有英文一种写法，直接显示会在中文界面上割裂。
      const message = t(issue === 'required' ? 'logicalModels.create.idRequired' : 'logicalModels.create.idInvalid')
      setIdError(message)
      toast.error(message)
      return
    }
    setIdError('')
    setSaving(true)
    try {
      // 只管闭包：数据记录 id 由服务端生成，用户在这里给出的就是模型名（`modelId`）。
      await createLogicalModel(buildCreateLogicalModelInput({ modelId, description }))
      toast.success(t('logicalModels.create.created'))
      setModelId('')
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
              value={modelId}
              aria-invalid={Boolean(idError)}
              onChange={event => { setModelId(event.target.value); if (idError) setIdError('') }}
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
          <Button disabled={saving} onClick={() => void submit()}>{saving ? t('logicalModels.create.submitting') : t('logicalModels.create.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
