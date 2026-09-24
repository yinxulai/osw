import { FolderTree } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow, FormSelect, type FormOption } from '@/components/form-kit'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'
import type { AgentClientFileDefinition } from '@/catalog/clients'

interface FilePickerCardProps {
  filePath: string
  files: readonly AgentClientFileDefinition[]
  onSelectFile: (filePath: string) => void
}

/**
 * 「改哪一份文件」——只有声明了多份文件的客户端（Gemini CLI、OpenCode、Pi）才出现。
 *
 * 单独成卡而不是并进下面的值表单：它决定的是**整页在编辑哪个文件**，属于前提而不是内容，
 * 和表单混在一起会让人以为切换文件只是改了一个字段。单文件客户端连这张卡都没有，
 * 路径在内容卡片的头里已经写着，不必再说一遍。
 */
export function FilePickerCard(props: FilePickerCardProps) {
  const { filePath, files, onSelectFile } = props
  const t = useTranslation()

  const options: FormOption[] = files.map(file => ({ value: file.path, label: file.path }))

  return (
    <Card>
      <SettingsCardHeader icon={<FolderTree />} title={t('clientConfig.file.title')} description={t('clientConfig.file.description')} />

      <CardContent className="divide-y divide-border/50 border-t border-border/50 pt-0">
        {/* 路径只在右侧下拉里出现一次：同一行再说一遍只是重复。 */}
        <FormRow
          title={t('clientConfig.step.file')}
          control={<FormSelect value={filePath} onValueChange={onSelectFile} options={options} ariaLabel={t('clientConfig.step.file')} />}
        />
      </CardContent>
    </Card>
  )
}
