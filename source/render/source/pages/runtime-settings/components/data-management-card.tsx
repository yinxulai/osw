import { useRef } from 'react'
import { Download, FolderSync, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsCardHeader } from './settings-card-header'
import { Card, CardContent } from '@/components/ui/card'

interface DataManagementCardProps {
  onExport: () => void
  onImport: (file: File) => void
}

export function DataManagementCard(props: DataManagementCardProps) {
  const { onExport, onImport } = props
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      onImport(file)
    }
    event.target.value = '' // 重置 input，允许重复导入同一文件
  }

  return (
    <Card>
      <SettingsCardHeader icon={<FolderSync />} title="配置迁移" description="在设备间导入或导出应用配置" />
      <CardContent className="px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onExport}>
            <Download />
            导出配置
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload />
            导入配置
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          API Key 会自动脱敏；自定义代理 URL 中的凭据仍会完整导出。
        </p>
      </CardContent>
    </Card>
  )
}
