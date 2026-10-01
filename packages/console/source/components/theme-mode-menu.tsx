import { Monitor, Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { Theme, ThemeMode } from '@/components/app-sidebar'

const THEME_MODE_OPTIONS = [
  { value: 'light', icon: Sun, labelKey: 'settings.appearance.theme.light' },
  { value: 'dark', icon: Moon, labelKey: 'settings.appearance.theme.dark' },
  { value: 'system', icon: Monitor, labelKey: 'settings.appearance.theme.system' },
] as const satisfies ReadonlyArray<{ value: ThemeMode; icon: typeof Sun; labelKey: UiCatalogKey }>

/** 某个主题模式的展示名。侧边栏折叠行的文字与菜单项共用同一份，两处不会漂移。 */
export function themeModeLabelKey(mode: ThemeMode): UiCatalogKey {
  return THEME_MODE_OPTIONS.find(option => option.value === mode)?.labelKey
    ?? 'settings.appearance.theme.system'
}

export interface ThemeModeMenuProps {
  /** 屏幕此刻的生效亮暗：决定触发器图标（跟随系统时随系统实时变）。 */
  theme: Theme
  /** 当前主题偏好（含「跟随系统」）：决定菜单里勾着哪一项。 */
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  /** 触发按钮的样式（外壳族系由调用方定，这里不掺侧边栏的私有色板）。 */
  className?: string
  /** 触发按钮里图标后面的内容，通常是折叠态控制显隐的文字。 */
  children?: ReactNode
}

/**
 * 主题模式的三选一菜单（浅色 / 深色 / 跟随系统），取代两态 toggle。
 *
 * 之所以是「直接寻址的菜单」而不是「点一下翻转」：偏好是三态，两态按钮装不下它——
 * toggle 只能在亮暗间打转，「跟随系统」既看不到也回不去，点一下还会静默把偏好改成
 * 具体亮暗。菜单把三个目标都摆出来，当前项勾选；代价是多一次点击，换来状态可见、
 * 可达，且交互模型和偏好数据的真实形态一致。
 *
 * 文案直接复用设置页的 `settings.appearance.theme.*`：同一个语义两套说法只会让
 * 「侧边栏的跟随系统」和「设置页的跟随系统」看起来像两个东西。
 */
export function ThemeModeMenu(props: ThemeModeMenuProps) {
  const t = useTranslation()
  const TriggerIcon = props.theme === 'dark' ? Moon : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={t('settings.appearance.themeAria')}
        className={props.className}
      >
        <TriggerIcon aria-hidden="true" />
        {props.children}
      </DropdownMenuTrigger>
      {/* 侧边栏贴着窗口左缘，菜单向右展开；宽度钉死，折叠态 48px 的触发器不会把菜单挤窄。 */}
      <DropdownMenuContent side="right" align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={props.themeMode}
          onValueChange={value => props.onThemeModeChange(value as ThemeMode)}
        >
          {THEME_MODE_OPTIONS.map(option => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon aria-hidden="true" className="text-text-secondary" />
              {t(option.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
