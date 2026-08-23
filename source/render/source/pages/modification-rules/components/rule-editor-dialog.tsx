import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RuleEditor } from './rule-editor'
import type { ModificationRule } from '../types'

interface RuleEditorDialogProps {
  open: boolean
  rule: ModificationRule
  dirty: boolean
  onOpenChange: (open: boolean) => void
  onChange: (rule: ModificationRule) => void
  onSave: () => void
  onReset: () => void
}

export function RuleEditorDialog(props: RuleEditorDialogProps) {
  const close = () => props.onOpenChange(false)
  const cancel = () => {
    if (props.dirty) props.onReset()
    close()
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        overlayClassName="bg-black/30"
        className="inset-y-0 left-auto right-0 top-0 flex h-dvh w-full max-w-2xl translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-card text-card-foreground p-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:rounded-none"
      >
        <DialogHeader className="shrink-0 px-5 py-4 pr-14">
          <DialogTitle>编辑修改规则</DialogTitle>
          <DialogDescription className="text-xs">配置规则作用范围、匹配协议和修改动作。</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background/60">
          <RuleEditor
            rule={props.rule}
            dirty={props.dirty}
            onChange={props.onChange}
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 bg-card px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={cancel}>关闭</Button>
          <Button type="button" size="sm" onClick={props.onSave} disabled={!props.dirty}>
            <Save /> 保存规则
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
