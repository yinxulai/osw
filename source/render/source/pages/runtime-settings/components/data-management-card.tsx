import { useRef } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface DataManagementCardProps {
  importMessage: string
  importSuccess: boolean
  onExport: () => void
  onImport: (file: File) => void
}

export function DataManagementCard(props: DataManagementCardProps) {
  const { importMessage, importSuccess, onExport, onImport } = props
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
      <CardHeader className="pb-2">
        <CardTitle>数据管理</CardTitle>
        <CardDescription>导出或导入配置，API Key 将被脱敏导出</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onExport}>
            <Download className="mr-1 h-3.5 w-3.5" />
            导出配置
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
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
        {importMessage && (
          <div
            className={
              'mt-3 rounded-md border px-3 py-2 text-xs ' +
              (importSuccess
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600'
                : 'border-destructive/30 bg-destructive/5 text-destructive')
            }
          >
            {importMessage}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          导出的配置文件不包含 API Key。导入时需在文件中手动添加{' '}
          <code className="rounded bg-muted px-1">apiKey</code> 字段。
        </p>
      </CardContent>
    </Card>
  )
}
