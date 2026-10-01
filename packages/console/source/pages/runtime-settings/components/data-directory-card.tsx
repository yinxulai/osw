import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow } from '@/components/form-kit'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { formatBytes } from '@/lib/format-bytes'
import { getPlatformCapabilities } from '@/platform/capabilities'

interface DataDirectoryCardProps {
  /**
   * 观测库当前占用的字节数，读不到时为 `null`。
   *
   * 用 `null` 而不是 `0` 表示「还不知道」：0 是个有意义的读数（空库），两者混淆会让人
   * 以为库被清空了。渲染上两者走同一套排版，未就绪就显示占位符。
   */
  storageBytes: number | null
}

/**
 * 数据目录：位置说明 + 一个「用文件管理器打开」的入口。
 *
 * 目录本身不出现在界面上：它由主进程按运行环境算（桌面端与命令行共用同一处，见
 * `apps/docs/specs/packaging.md` §5.5），渲染层复制一份只会有算错的机会；打开之后
 * 文件管理器自己会把路径显示出来。
 *
 * 浏览器形态拿不到这个能力（目录在那台机器上），按「正常但不可用」渲染：同一行、
 * 同一个位置，只是按钮点不动、说明换成原因——不换一套简化排版（见 `platform/capabilities.ts`）。
 *
 * 占用读数跟目录摆在一起：它是这个目录大小的唯一可见反馈，而目录本身不显示路径，
 * 两者分开后用户就少了一条「东西长了多少、都在哪」的线索。
 */
export function DataDirectoryCard(props: DataDirectoryCardProps) {
  const t = useTranslation()
  const toast = useToast()
  const openDataDirectory = getPlatformCapabilities().openDataDirectory
  const [opening, setOpening] = useState(false)

  /**
   * 失败要说出来。打开目录在系统层可能失败（没有默认文件管理器、目录被移走），
   * 静默失败会让按钮看起来像是点了没反应。
   */
  async function handleOpen() {
    if (openDataDirectory === null || opening) return
    setOpening(true)
    try {
      await openDataDirectory()
    } catch (error) {
      toast.error(t('settings.dataDirectory.openFailed', {
        message: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setOpening(false)
    }
  }

  return (
    <Card>
      <SettingsCardHeader
        icon={<FolderOpen />}
        title={t('settings.dataDirectory.title')}
        description={t('settings.dataDirectory.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.dataDirectory.open')}
          description={openDataDirectory === null
            ? t('settings.dataDirectory.unavailable')
            : t('settings.dataDirectory.openDescription')}
          control={(
            <Button
              variant="outline"
              size="sm"
              disabled={openDataDirectory === null || opening}
              onClick={() => void handleOpen()}
            >
              <FolderOpen />
              {t('settings.dataDirectory.openAction')}
            </Button>
          )}
        />

        {/** 「清理历史日志」完成后这个读数会失效重取，用户能当场看到它变小。 */}
        <FormRow
          title={t('settings.dataDirectory.storage')}
          description={t('settings.dataDirectory.storageDescription')}
          control={(
            <span className="system-sm-medium tabular-nums text-text-primary">
              {props.storageBytes === null ? '—' : formatBytes(props.storageBytes)}
            </span>
          )}
        />
      </CardContent>
    </Card>
  )
}
