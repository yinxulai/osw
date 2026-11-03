/**
 * 组件规格抽取。
 *
 * 页面上每个组件下方那行「h 32 · px 12 · gap 6 · r 6 · 13/16」不是手抄的，
 * 而是从组件源码里那段真实的 class 字符串解析出来的：先按 anchor 精确找到那一行
 * （找不到就让生成失败，绝不回退到默认值），再把 Tailwind 工具类换算成 px。
 *
 * 换算规则只有三种来源，全部可核对：
 * - 间距类（h/px/py/p/gap/size）＝ 数字 × 4px。4px 是 Tailwind v4 的 `--spacing`
 *   默认值；本仓库 `index.css` 没有覆盖它（grep `--spacing` 为空），所以这是框架默认而非猜测。
 * - 圆角类（rounded-*）＝ 仓库自己声明的 `--radius-*`（见 index.css:70-73 与 123）。
 * - 字号/行高：`text-[13px]` 直接取值；`system-*` 查排版表；`text-xs`/`text-sm` 对应
 *   `system-xs-*`(12/16) 与 `system-md-*`(14/20)——这两条是 Tailwind 的别名，写在下面的 MAP 里。
 */

/** anchor 必须与源码逐字一致；对不上就会抛错，避免文档悄悄漂移。 */
const COMPONENTS = [
  {
    id: 'button',
    name: 'Button',
    file: 'packages/console/source/components/ui/button.tsx',
    parts: [
      ['base', 'inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent'],
      ['size', 'h-8 gap-1.5 px-3'],
    ],
  },
  {
    id: 'input',
    name: 'Input',
    file: 'packages/console/source/components/ui/input.tsx',
    parts: [
      [
        'base',
        'flex h-8 w-full min-w-0 rounded-lg border border-transparent bg-components-input-bg-normal px-3 py-1.5 text-[13px] leading-4',
      ],
    ],
  },
  {
    id: 'select',
    name: 'Select',
    file: 'packages/console/source/components/ui/select.tsx',
    parts: [
      [
        'base',
        'flex w-fit items-center justify-between gap-1.5 rounded-lg border border-transparent bg-components-input-bg-normal py-2 pr-2 pl-3 text-[13px] leading-4',
      ],
      ['size', 'data-[size=default]:h-8'],
    ],
  },
  {
    id: 'badge',
    name: 'Badge',
    file: 'packages/console/source/components/ui/badge.tsx',
    parts: [
      [
        'base',
        'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md px-2 py-0.5 system-2xs-medium',
      ],
    ],
  },
  {
    id: 'card',
    name: 'Card',
    file: 'packages/console/source/components/ui/card.tsx',
    parts: [
      [
        'base',
        'flex flex-col gap-0 overflow-hidden rounded-xl border border-module-border bg-card py-(--card-spacing) text-sm text-card-foreground shadow-card [--card-spacing:--spacing(4)]',
      ],
    ],
  },
  {
    id: 'dialog',
    name: 'Dialog',
    file: 'packages/console/source/components/ui/dialog.tsx',
    parts: [
      [
        'base',
        'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm',
      ],
    ],
  },
  {
    id: 'tooltip',
    name: 'Tooltip',
    file: 'packages/console/source/components/ui/tooltip.tsx',
    parts: [
      [
        'base',
        'z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs',
      ],
    ],
  },
  {
    id: 'table',
    name: 'Table',
    file: 'packages/console/source/components/ui/table.tsx',
    parts: [['base', 'w-full caption-bottom system-xs-regular']],
  },
  {
    id: 'skeleton',
    name: 'Skeleton',
    file: 'packages/console/source/components/ui/skeleton.tsx',
    parts: [['base', 'animate-pulse rounded-md bg-inset']],
  },
  {
    id: 'empty',
    name: 'Empty',
    file: 'packages/console/source/components/ui/empty.tsx',
    parts: [
      ['base', 'flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6'],
    ],
  },
]

const TEXT_ALIASES = {
  xs: { fontSize: 12, lineHeight: 16 },
  sm: { fontSize: 14, lineHeight: 20 },
}

const lineAt = (content, index) => content.slice(0, index).split('\n').length

/**
 * 把一个 class 串换算成规格。返回 `{ values, traces }`：
 * `values` 供渲染用，`traces` 保留每个数字来自哪个 class，页面上可展开核对。
 */
const resolveUtilities = (classes, { typography, radii }) => {
  const values = {}
  const traces = []

  const radiusByName = new Map(radii.map(item => [item.name.replace('--radius-', ''), item.px]))
  const typeByName = new Map(typography.map(item => [item.name, item]))

  const set = (key, value, from) => {
    if (value === null || value === undefined) return
    // 排版表里的字号/行高是 `"11px"` 这样的字符串，这里统一成数字。
    if (typeof value === 'string' && /^[\d.]+px$/.test(value)) value = Number.parseFloat(value)
    if (values[key] !== undefined) return
    values[key] = value
    traces.push({ key, value, from })
  }

  for (const raw of classes.split(/\s+/)) {
    if (!raw) continue
    // 变体前缀（hover:/data-[size=sm]:）去掉；但 `[--card-spacing:--spacing(4)]` 本身带冒号，
    // 它不是变体，不能按冒号切。
    const isArbitraryProperty = raw.startsWith('[')
    const utility = !isArbitraryProperty && /^[a-z-]+:/.test(raw) ? raw.slice(raw.indexOf(':') + 1) : raw
    // 0.5 的间距是 2px，允许，但记下来时保留原始 class。
    const step = match => Number.parseFloat(match) * 4

    let match = utility.match(/^h-(\d+(?:\.\d+)?)$/)
    if (match) set('height', step(match[1]), utility)

    match = utility.match(/^size-(\d+(?:\.\d+)?)$/)
    if (match) {
      set('width', step(match[1]), utility)
      set('height', step(match[1]), utility)
    }

    match = utility.match(/^px-(\d+(?:\.\d+)?)$/)
    if (match) set('paddingX', step(match[1]), utility)

    match = utility.match(/^py-(\d+(?:\.\d+)?)$/)
    if (match) set('paddingY', step(match[1]), utility)

    match = utility.match(/^p-(\d+(?:\.\d+)?)$/)
    if (match) set('padding', step(match[1]), utility)

    match = utility.match(/^(?:pl|pr)-(\d+(?:\.\d+)?)$/)
    if (match) {
      const key = utility.startsWith('pl') ? 'paddingLeft' : 'paddingRight'
      set(key, step(match[1]), utility)
    }

    match = utility.match(/^gap-(\d+(?:\.\d+)?)$/)
    if (match) set('gap', step(match[1]), utility)

    match = utility.match(/^rounded-(sm|md|lg|xl|2xl)$/)
    if (match) set('radius', radiusByName.get(match[1]) ?? null, utility)

    match = utility.match(/^rounded-\[(\d+(?:\.\d+)?)px\]$/)
    if (match) set('radius', Number.parseFloat(match[1]), utility)

    match = utility.match(/^border(-\[[\d.]+px\])?$/)
    if (match) set('borderWidth', match[1] ? Number.parseFloat(match[1].slice(2, -3)) : 1, utility)

    match = utility.match(/^text-\[(\d+(?:\.\d+)?)px\]$/)
    if (match) set('fontSize', Number.parseFloat(match[1]), utility)

    match = utility.match(/^text-(xs|sm)$/)
    if (match) {
      set('fontSize', TEXT_ALIASES[match[1]].fontSize, utility)
      set('lineHeight', TEXT_ALIASES[match[1]].lineHeight, utility)
    }

    match = utility.match(/^leading-(\d+(?:\.\d+)?)$/)
    if (match) set('lineHeight', step(match[1]), utility)

    const type = typeByName.get(utility)
    if (type) {
      set('fontSize', type.fontSize, utility)
      set('lineHeight', type.lineHeight, utility)
    }

    // `py-(--card-spacing)` + `[--card-spacing:--spacing(4)]`：先记下变量名，等扫完再回填。
    match = utility.match(/^py-\((--[a-z-]+)\)$/)
    if (match) values.paddingYVariable = match[1]

    match = utility.match(/^\[(--[a-z-]+):--spacing\((\d+(?:\.\d+)?)\)\]$/)
    if (match) values[`${match[1]}:spacing`] = step(match[2])
  }

  if (values.paddingYVariable) {
    const resolved = values[`${values.paddingYVariable}:spacing`]
    if (resolved !== undefined) {
      values.paddingY = resolved
      traces.push({ key: 'paddingY', value: resolved, from: `py-(${values.paddingYVariable})` })
    }
    delete values.paddingYVariable
    for (const key of Object.keys(values)) {
      if (key.endsWith(':spacing')) delete values[key]
    }
  }

  return { values, traces }
}

export const buildComponentSpecs = ({ root, readFile, typography, radii }) => {
  const cache = new Map()

  return COMPONENTS.map(component => {
    const absolute = `${root}/${component.file}`
    if (!cache.has(absolute)) cache.set(absolute, readFile(absolute))

    const content = cache.get(absolute)
    const anchors = []
    const values = {}
    const traces = []

    for (const [key, anchor] of component.parts) {
      const index = content.indexOf(anchor)
      if (index === -1) {
        throw new Error(`${component.name}: 在 ${component.file} 找不到 anchor「${anchor}」，文档与源码已漂移`)
      }
      anchors.push({ key, line: lineAt(content, index) })
      const resolved = resolveUtilities(anchor, { typography, radii })
      Object.assign(values, Object.fromEntries(Object.entries(resolved.values).filter(([name]) => values[name] === undefined)))
      traces.push(...resolved.traces)
    }

    return {
      id: component.id,
      name: component.name,
      file: component.file,
      anchors,
      specs: traces,
    }
  })
}
