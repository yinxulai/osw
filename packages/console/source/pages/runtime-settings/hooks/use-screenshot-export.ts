import { useCallback, useEffect, useState } from 'react'
import { getPlatformCapabilities } from '@/platform/capabilities'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

export function useScreenshotExport() {
  const toast = useToast()
  const t = useTranslation()
  const screenshotExport = getPlatformCapabilities().screenshotExport
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<ScreenshotExportProgress | null>(null)

  useEffect(() => screenshotExport?.onProgress(setProgress), [screenshotExport])

  const exportScreenshots = useCallback(async () => {
    if (!screenshotExport || exporting) return

    setExporting(true)
    setProgress({ completed: 0, total: 20, current: '' })
    try {
      const result = await screenshotExport.exportAll()
      toast.success(t('settings.development.screenshotsDone', {
        count: result.count,
        path: result.outputDirectory,
      }))
    } catch (error) {
      toast.error(t('settings.development.screenshotsFailed', {
        message: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }, [exporting, screenshotExport, t, toast])

  return {
    exporting,
    progress,
    exportScreenshots,
  }
}
