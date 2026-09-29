import { useDevelopmentSeed } from './hooks/use-development-seed'
import { useRequestLogRetention } from './hooks/use-request-log-retention'
import { useRuntimeDataReload } from './hooks/use-runtime-data-reload'
import { useSettingsForm } from './hooks/use-settings-form'
import { useStorageUsage } from './hooks/use-storage-usage'
import { useScreenshotExport } from './hooks/use-screenshot-export'

export function useRuntimeSettingsService() {
  const form = useSettingsForm()
  const retention = useRequestLogRetention()
  const reload = useRuntimeDataReload()
  const development = useDevelopmentSeed(reload)
  const screenshots = useScreenshotExport()
  const storageBytes = useStorageUsage()

  return {
    settings: form.settings,
    proxyStatus: form.proxyStatus,
    loading: form.loading,
    saving: form.saving,
    saved: form.saved,
    isDirty: form.isDirty,
    updateField: form.updateField,
    resetSettings: form.resetSettings,
    saveSettings: form.saveSettings,
    pruneLogs: retention.pruneLogs,
    storageBytes,
    reload,
    seedDevelopmentData: development.seedDevelopmentData,
    exportScreenshots: screenshots.exportScreenshots,
    exportingScreenshots: screenshots.exporting,
    screenshotExportProgress: screenshots.progress,
  }
}
