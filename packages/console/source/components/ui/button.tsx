import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-[13px] leading-4 font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-state-accent-solid active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-components-button-primary-bg text-components-button-primary-text inset-ring-[0.5px] inset-ring-components-button-primary-border hover:bg-components-button-primary-bg-hover",
        outline:
          "bg-components-button-secondary-bg text-components-button-secondary-text inset-ring-[0.5px] inset-ring-components-button-secondary-border hover:bg-components-button-secondary-bg-hover hover:inset-ring-components-button-secondary-border-hover aria-expanded:bg-components-button-secondary-bg-hover",
        secondary:
          "bg-components-button-tertiary-bg text-components-button-tertiary-text hover:bg-components-button-tertiary-bg-hover aria-expanded:bg-components-button-tertiary-bg-hover",
        ghost:
          "text-components-button-ghost-text hover:bg-components-button-ghost-bg-hover aria-expanded:bg-components-button-ghost-bg-hover",
        destructive:
          "bg-destructive/10 text-components-button-destructive-ghost-text hover:bg-destructive/20 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-[12px] leading-4 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[13px] leading-4 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      // 默认尺寸与 Input / Select 保持一致（h-8、text-sm）：
      // 表单行里按钮和输入框不等高是最容易看出来的不齐，所以默认值不再取 sm。
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

/**
 * 必须 `forwardRef`：Radix 的 `asChild` 触发器（`DropdownMenuTrigger` 等）要把 ref
 * 落到真实 DOM 上才拿得到浮层锚点。普通函数组件在 React 18 下接不住 ref，
 * 锚点为空时浮层会被摆到视口外（`translate(0, -200%)`），看起来就是「点了没反应」。
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(params, ref) {
  // size 不写参数默认值：写了会盖掉 cva 的 defaultVariants，
  // 于是所有未指定尺寸的按钮都退回 h-7，和 h-8 的 Input / Select 对不齐。
  const { className, variant = "default", size, asChild = false, ...props } = params
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
})

export { Button, buttonVariants }
