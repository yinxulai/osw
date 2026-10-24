/**
 * 已应用的界面语言偏好。
 *
 * **权威来源是服务端设置**（主进程要读它渲染托盘与原生菜单），但设置页改语言时希望立刻生效，
 * 所以这里放一份「当前已应用」的内存状态：
 * - 启动时用 localStorage 里上一次的偏好 + 系统语言先猜一个，避免先渲染英文再跳成中文；
 * - 服务端设置到手后由 `I18nProvider` 覆盖；
 * - 设置页改动时由设置页直接写入，作为保存前的预览。
 */

import type { LanguagePreference } from '@common/i18n'
import { createPersistedStore } from '@/store/persisted-store'

interface LanguageState {
  preference: LanguagePreference
  setPreference: (preference: LanguagePreference) => void
}

type PersistedLanguageState = Pick<LanguageState, 'preference'>

export const useLanguageStore = createPersistedStore<LanguageState, PersistedLanguageState>({
  key: 'osw-language',
  // 语言是这台机器上的偏好：换台机器重新按系统语言来一遍是对的。
  scope: 'machine',
  create: set => ({
    preference: 'system',
    setPreference: preference => set({ preference }),
  }),
  pick: state => ({ preference: state.preference }),
  defaults: { preference: 'system' },
}).store

/** 渲染进程能拿到的系统语言；Electron 会把应用 locale 透传到 `navigator.language`。 */
export function getSystemLocale(): string | null {
  return typeof navigator === 'undefined' ? null : navigator.language
}
