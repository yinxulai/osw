import { useCallback, useState } from 'react'
import { providerApi } from '@/api/providers'
import { useToast } from '@/components/ui/toast'
import { useAsyncFn } from '@/services/use-async'
import type { Provider } from '@common/schemas'
import { PROTOCOL_OPTIONS } from '../lib/protocols'
import type { ProviderPreset } from '../lib/provider-presets'
import type { ProviderEndpointEntry, ProviderEndpoints } from './types'

interface UseProviderDialogOptions {
  reload: () => Promise<void>
  selectProvider: (id: string) => void
}

export function useProviderDialog(options: UseProviderDialogOptions) {
  const { reload, selectProvider } = options
  const toast = useToast()
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [providerName, setProviderName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [timeout, setTimeout] = useState('30000')
  const [providerEndpointEntries, setProviderEndpointEntries] = useState<ProviderEndpointEntry[]>([])

  const openProviderDialog = useCallback(async (provider?: Provider) => {
    let endpoints: ProviderEndpoints = {}
    if (provider) {
      const result = await providerApi.endpoints(provider.id)
      if (!result.success) {
        toast.error(result.errorMessage)
        return
      }
      endpoints = Object.fromEntries(
        result.data.filter(endpoint => endpoint.enabled).map(endpoint => [endpoint.protocol, endpoint.url]),
      )
    }
    setEditingProviderId(provider?.id ?? null)
    setProviderName(provider?.name ?? '')
    setApiKey('')
    setTimeout(String(provider?.timeoutMilliseconds ?? 30000))
    setProviderEndpointEntries(PROTOCOL_OPTIONS.map(option => {
      const url = endpoints[option.value] ?? ''
      return { protocol: option.value, enabled: Boolean(url), url }
    }))
    setProviderDialogOpen(true)
  }, [toast])

  const closeProviderDialog = useCallback(() => setProviderDialogOpen(false), [])

  const applyPreset = useCallback((preset: ProviderPreset) => {
    setProviderName(preset.name)
    setProviderEndpointEntries(PROTOCOL_OPTIONS.map(option => {
      const url = preset.endpoints[option.value] ?? ''
      return { protocol: option.value, enabled: Boolean(url), url }
    }))
  }, [])

  const updateProviderEndpointEntry = useCallback((index: number, patch: Partial<ProviderEndpointEntry>) => {
    setProviderEndpointEntries(current => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry))
  }, [])

  const saveProvider = useCallback(async () => {
    if (!providerName.trim()) return
    const endpoints: Record<string, string> = Object.fromEntries(
      providerEndpointEntries
        .filter(entry => entry.enabled)
        .map(entry => [entry.protocol, entry.url.trim()])
        .filter(([, value]) => value),
    )
    const result = editingProviderId
      ? await providerApi.update(editingProviderId, {
          name: providerName.trim(),
          timeoutMilliseconds: Number(timeout),
          endpoints,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        })
      : await providerApi.create({
          name: providerName.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          timeoutMilliseconds: Number(timeout),
          endpoints,
        })
    if (!result.success) {
      toast.error(result.errorMessage)
      return
    }
    setProviderDialogOpen(false)
    selectProvider(result.data.id)
    toast.success(editingProviderId ? '供应商已更新' : '供应商已添加')
    await reload()
  }, [apiKey, editingProviderId, providerEndpointEntries, providerName, reload, selectProvider, timeout, toast])

  const { loading: savingProvider, run: runSaveProvider } = useAsyncFn(saveProvider)

  return {
    providerDialogOpen,
    setProviderDialogOpen,
    editingProviderId,
    providerName,
    apiKey,
    timeout,
    providerEndpointEntries,
    setProviderName,
    setApiKey,
    setTimeout,
    updateProviderEndpointEntry,
    openProviderDialog,
    closeProviderDialog,
    applyPreset,
    saveProvider: runSaveProvider,
    savingProvider,
  }
}
