import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PluginInstallSource, PluginView } from '@common/plugin'
import { pluginApi } from '@/api/plugins'
import { unwrap } from '@/api/unwrap'

export const pluginKeys = { all: ['plugins'] as const }

const EMPTY_PLUGINS: PluginView[] = []

const usePluginsQuery = () => useQuery({
  queryKey: pluginKeys.all,
  queryFn: () => unwrap(pluginApi.list()),
  refetchInterval: 15_000,
})

export function usePlugins() {
  return usePluginsQuery().data ?? EMPTY_PLUGINS
}

export function usePluginsLoading() {
  return usePluginsQuery().isPending
}

export function usePluginsActions() {
  const client = useQueryClient()

  const refresh = useCallback(() => {
    return client.invalidateQueries({ queryKey: pluginKeys.all })
  }, [client])

  const install = useCallback(async (source: PluginInstallSource) => {
    const plugin = await unwrap(pluginApi.install(source))
    client.setQueryData(pluginKeys.all, (previous: PluginView[] | undefined) => {
      if (!previous) return [plugin]
      return [plugin, ...previous.filter(item => item.key !== plugin.key)]
    })
    await refresh()
    return plugin
  }, [client, refresh])

  const enable = useCallback(async (key: string, inputs?: Record<string, string>) => {
    const result = await unwrap(pluginApi.enable(key, inputs))
    await refresh()
    return result
  }, [refresh])

  const disable = useCallback(async (key: string) => {
    const result = await unwrap(pluginApi.disable(key))
    await refresh()
    return result
  }, [refresh])

  const sync = useCallback(async (key: string) => {
    const result = await unwrap(pluginApi.sync(key))
    await refresh()
    return result
  }, [refresh])

  const setInputs = useCallback(async (key: string, inputs: Record<string, string>) => {
    const result = await unwrap(pluginApi.setInputs(key, inputs))
    await refresh()
    return result
  }, [refresh])

  const reload = useCallback(async (key: string) => {
    const result = await unwrap(pluginApi.reload(key))
    await refresh()
    return result
  }, [refresh])

  const uninstall = useCallback(async (key: string) => {
    const result = await unwrap(pluginApi.uninstall(key))
    await refresh()
    return result
  }, [refresh])

  return { refresh, install, enable, disable, sync, setInputs, reload, uninstall }
}
