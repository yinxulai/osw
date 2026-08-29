import { useCallback, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { providerApi } from '@/api/providers'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
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

  const openPresetDialog = useCallback((preset: ProviderPreset) => {
    setEditingProviderId(null)
    setProviderName(preset.name)
    setApiKey('')
    setTimeout('30000')
    setProviderEndpointEntries(PROTOCOL_OPTIONS.map(option => {
      const url = preset.endpoints[option.value] ?? ''
      return { protocol: option.value, enabled: Boolean(url), url }
    }))
    setProviderDialogOpen(true)
  }, [])

  const updateProviderEndpointEntry = useCallback((index: number, patch: Partial<ProviderEndpointEntry>) => {
    setProviderEndpointEntries(current => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry))
  }, [])

  const saveMutation = useMutation({ mutationFn: async () => {
    if (!providerName.trim()) throw new Error('请输入供应商名称')
    const endpoints: Record<string, string> = Object.fromEntries(providerEndpointEntries.filter(entry => entry.enabled).map(entry => [entry.protocol, entry.url.trim()]).filter(([, value]) => value))
    const payload = { name: providerName.trim(), timeoutMilliseconds: Number(timeout), endpoints, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }
    return editingProviderId ? unwrap(providerApi.update(editingProviderId, payload)) : unwrap(providerApi.create(payload))
  }, onSuccess: async provider => { setProviderDialogOpen(false); selectProvider(provider.id); toast.success(editingProviderId ? '供应商已更新' : '供应商已添加'); await reload() }, onError: error => toast.error(error.message) })
  const saveProvider = useCallback(async () => { await saveMutation.mutateAsync().catch(() => undefined) }, [saveMutation])

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
    openPresetDialog,
    openProviderDialog,
    closeProviderDialog,
    saveProvider,
    savingProvider: saveMutation.isPending,
  }
}
