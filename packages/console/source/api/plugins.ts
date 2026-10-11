import type { PluginInstallSource, PluginView } from '@common/plugin'
import { request } from './client'

export const pluginApi = {
  list: () => request<PluginView[]>('/plugin/list'),
  get: (key: string) => request<PluginView>('/plugin/get', { key }),
  install: (source: PluginInstallSource) => request<PluginView>('/plugin/install', { source }),
  uninstall: (key: string) => request<{ key: string }>('/plugin/uninstall', { key }),
  enable: (key: string, inputs?: Record<string, string>) => request<{ key: string }>('/plugin/enable', { key, inputs }),
  disable: (key: string) => request<{ key: string }>('/plugin/disable', { key }),
  sync: (key: string) => request<{ key: string }>('/plugin/sync', { key }),
  setInputs: (key: string, inputs: Record<string, string>) => request<{ key: string }>('/plugin/set-inputs', { key, inputs }),
  reload: (key: string) => request<{ key: string }>('/plugin/reload', { key }),
  icon: (key: string) => request<{ key: string; svg: string | null }>('/plugin/icon', { key }),
}
