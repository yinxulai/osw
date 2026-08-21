import { useRef } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
      <CardHeader className="border-b border-border/60 px-4 py-4">
        <CardTitle>数据管理</CardTitle>
        <CardDescription>导出或导入配置，API Key 将被脱敏导出</CardDescription>
      </CardHeader>
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
        <p className="mt-2 text-[11px] text-muted-foreground">
          导出的配置文件不包含 API Key。导入时需在文件中手动添加{' '}
          <code className="rounded bg-muted px-1">apiKey</code> 字段。
        </p>
      </CardContent>
    </Card>
  )
}
