import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { CheckIcon, MinusIcon } from "lucide-react"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        /*
         * 未选中态的描边不能用 `border-input`：暗色下它是 `hsl(0 0% 16%)`（≈ #292929），
         * 而它坐的卡面是 `--card` 12%（≈ #1f1f1f）—— 两者只差 1.1:1，等于没画。
         * 用户报的「渠道诊断里的勾选框看不清」就是这个：右侧面板是一个 `bg-card`，
         * 勾选框是那行唯一的可点区域，描边一隐形，整行就只剩一个纯文本的名字。
         *
         * 改用 `text-quaternary`（亮 `rgb(16 24 40/0.5)` / 暗 `rgb(200 206 218/0.5)`）：
         * 它对这个 16px 小方块是 **3.5:1**，正好越过 WCAG 1.4.11 对控件边界要求的 3:1；
         * 又因为带 alpha，叠在 card / parma / sidebar / popover 上都自动落到同一档，
         * 不用为每种底色各写一条。`border-module-border`（1.3:1）是给模块容器的，
         * 那个粗细放在 16px 控件上仍然看不见，别拿来替代。
         */
        "peer group/checkbox relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-text-quaternary transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-text-quaternary after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:not-data-checked:border-text-tertiary aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground dark:data-[state=indeterminate]:bg-primary",
        className
      )}
      {...props}
    >
      {/*
       * 两个图标常驻、靠状态切显隐：Radix 的 `Indicator` 在 `indeterminate` 时也是挂载的，
       * 条件渲染会让「半选」这个状态在 DOM 上无迹可寻，样式也没法只靠 `data-state` 表达。
       * `indeterminate` 没有对应的 Tailwind 变体（见 `shadcn/tailwind.css` 的 `@custom-variant`），
       * 所以整份代码里「半选」一律写成 `data-[state=indeterminate]:` 的任意值语法。
       */}
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon className="hidden group-data-[state=checked]/checkbox:block" />
        <MinusIcon className="hidden group-data-[state=indeterminate]/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
