import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CopyButtonProps {
  /** 复制回执用的 key，同一页面的多个入口各自独立反馈。 */
  itemKey: string
  value: string
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
  /** 无障碍名；同一个值用哪种形态，名字都一样。 */
  label: string
  className?: string
}

/**
 * 「可复制的值」旁边的复制按钮：成功后就地换成勾，回执留在按钮上。
 *
 * **只有一种形态。** 同一个页面里出现两种复制按钮（一种带文字、一种只有图标），用户每遇到一个
 * 就得重新认一次「这里也能复制」；地址是三个值里最重要的一个，但重要性该由值自己的字号承担，
 * 不该由按钮的形状承担——形状一变，读起来像是两种不同的操作。所以「带不带文字」不开放成参数。
 *
 * 值拼不出来（服务没跑、地址不全）时禁用而不是隐藏——布局不跟着数据有无变形。
 */
export function CopyButton(props: CopyButtonProps) {
  const { itemKey, value, copiedKey, onCopy, label, className } = props
  const copied = copiedKey === itemKey

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      disabled={!value}
      aria-label={label}
      title={label}
      onClick={() => onCopy(itemKey, value)}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}
