import { useRef } from 'react'
import { Download, Upload } from 'lucide-react'
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
    <Card className="border-border">
      <SettingsCardHeader title="数据管理" description="导出或导入配置，Provider API Key 将被脱敏" />
      <CardContent className="px-4 py-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onExport}>
            <Download className="mr-1 h-3.5 w-3.5" />
            导出配置
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
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
        <p className="mt-2 text-xs text-muted-foreground">
          导出文件不包含 Provider API Key，但自定义代理 URL 中的账号密码会完整导出，请妥善保管。
        </p>
      </CardContent>
    </Card>
  )
}
