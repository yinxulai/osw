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
    // 首帧进度先给一个「0 / 总数」：总数是页面数 × 中英 × 明暗，写死会随截图清单漂移，
    // 这里等第一条真实进度回来再对齐（见 `screenshot-export.ts` 的 `SCREENSHOT_EXPORT_CASES`）。
    setProgress({ completed: 0, total: 0, current: '' })
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
