import { useEffect, useState } from 'react'
import { LogicalModelIdSchema, type LogicalModel } from '@common/schemas'
import { logicalModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

interface EditLogicalModelDialogProps {
  /** 被编辑的逻辑模型；为 null 时说明数据还没就绪，对话框保持空壳。 */
  logicalModel: LogicalModel | null
  /** 内建默认逻辑模型：模型名是请求兜底匹配的依据，只允许改说明。 */
  builtIn?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 保存成功后回调，调用方负责刷新列表。 */
  onSaved: () => void
}

export function EditLogicalModelDialog(props: EditLogicalModelDialogProps) {
  const { logicalModel, builtIn, open, onOpenChange, onSaved } = props
  const toast = useToast()
  const t = useTranslation()
  const [modelId, setModelId] = useState('')
  const [description, setDescription] = useState('')
  const [idError, setIdError] = useState('')
  const [saving, setSaving] = useState(false)

  // 对话框是常驻组件，每次打开都按当前记录重新填表，否则第二次打开会残留上一次的草稿。
  useEffect(() => {
    if (!open || !logicalModel) return
    setModelId(logicalModel.modelId)
    setDescription(logicalModel.description)
    setIdError('')
  }, [open, logicalModel])

  const save = async () => {
    if (!logicalModel) return
    const trimmedId = modelId.trim()
    // 模型名就是身份，留空或写得不合法（它同时要能被请求当成模型名发出来）都会让这个逻辑模型
    // 从请求那一侧直接消失，所以就地拦下，而不是等服务端 schema 报错。
    if (!builtIn && !trimmedId) {
      setIdError(t('logicalModels.edit.idRequired'))
      return
    }
    if (!builtIn && !LogicalModelIdSchema.safeParse(trimmedId).success) {
      setIdError(t('logicalModels.edit.idInvalid'))
      return
    }
    setSaving(true)
    try {
      // 说明与模型名一并发出去：改名不只是一列 UPDATE，服务端还要在同一次事务里把引用它的
      // 路由落点与条件值一起搬走。分成两个请求就可能出现「名字改了、落点没跟上」的中间态。
      // 数据记录 id 不进请求体，它是路径上的那个 `id`。
      await unwrap(logicalModelApi.update(logicalModel.id, {
        ...(builtIn ? {} : { modelId: trimmedId }),
        description: description.trim(),
      }))
      toast.success(t('logicalModels.edit.saved'))
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('logicalModels.edit.title')}</DialogTitle>
          <DialogDescription>{t('logicalModels.edit.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField
            label={t('logicalModels.edit.idLabel')}
            htmlFor="logical-model-id"
            error={idError}
            required={!builtIn}
            hint={builtIn ? t('logicalModels.edit.builtInIdHint') : t('logicalModels.edit.idHint')}
          >
            <Input
              id="logical-model-id"
              value={modelId}
              disabled={builtIn}
              maxLength={64}
              aria-invalid={Boolean(idError)}
              onChange={event => { setModelId(event.target.value); if (idError) setIdError('') }}
              autoFocus={!builtIn}
            />
          </FormField>
          <FormField label={t('logicalModels.edit.descriptionLabel')} htmlFor="logical-model-edit-description">
            <Input
              id="logical-model-edit-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder={t('logicalModels.edit.descriptionPlaceholder')}
              autoFocus={builtIn}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.action.cancel')}</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? t('logicalModels.edit.submitting') : t('logicalModels.edit.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
