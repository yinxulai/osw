import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
  const readOnly = props.rule.builtin === true

  return (
    <Sheet open={props.open} onOpenChange={open => open ? props.onOpenChange(true) : cancel()}>
      <SheetContent
        side="right"
        className="w-[calc(100vw-1rem)]! max-w-300! gap-0 border-0 bg-card p-0 text-card-foreground shadow-none"
        onPointerDownOutside={event => event.preventDefault()}
      >
        <SheetHeader className="shrink-0 bg-card px-6 py-5 pr-14">
          <SheetTitle className="text-base">{props.rule.updatedAt === '尚未保存' ? '新建请求修改' : '编辑请求修改'}</SheetTitle>
          <SheetDescription className="text-xs">定义请求或响应中的字段转换。{readOnly && ' 系统内置规则仅供查看。'}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background/60">
          <RuleEditor
            rule={props.rule}
            onChange={props.onChange}
            readOnly={readOnly}
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 bg-card px-6 py-4">
          {props.dirty && <span className="mr-auto text-xs text-warning">未保存</span>}
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="sm">取消</Button>
          </SheetClose>
          <Button type="button" size="sm" onClick={props.onSave} disabled={readOnly || !props.dirty}>
            <Save /> 保存
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
