import { useConfigTransfer } from './hooks/use-config-transfer'
import { useDevelopmentSeed } from './hooks/use-development-seed'
import { useRequestLogRetention } from './hooks/use-request-log-retention'
import { useSettingsForm } from './hooks/use-settings-form'

export function useRuntimeSettingsService() {
  const form = useSettingsForm()
  const retention = useRequestLogRetention()
  const transfer = useConfigTransfer({ hydrateSettings: form.hydrate })
  const development = useDevelopmentSeed(transfer.reload)

  return {
    settings: form.settings,
    proxyStatus: form.proxyStatus,
    loading: form.loading,
    saving: form.saving,
    saved: form.saved,
    isDirty: form.isDirty,
    updateField: form.updateField,
    saveSettings: form.saveSettings,
    pruneLogs: retention.pruneLogs,
    reload: transfer.reload,
    exportConfig: transfer.exportConfig,
    importConfig: transfer.importConfig,
    seedDevelopmentData: development.seedDevelopmentData,
  }
}
