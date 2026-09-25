import { FolderTree } from 'lucide-react'
import { FormSelect, type FormOption } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import type { AgentClientFileDefinition } from '@/catalog/clients'

interface FilePickerBandProps {
  filePath: string
  files: readonly AgentClientFileDefinition[]
  onSelectFile: (filePath: string) => void
}

/**
 * 「改哪一份文件」——声明了多份文件的客户端才出现。
 *
 * 形态是**一条前提带**，不是一张卡：它决定的是整页在编辑哪个文件（后面两块的前提），
 * 内容又只有一行。撑成一整张卡时，卡头 + 一行下拉在 120px 里空掉大半，
 * 而且它和下面两张卡一样厚，读不出「前提 → 决定 → 事实」的层次。
 *
 * 单文件客户端连这条带都没有：路径在内容卡片的头里已经写着，不必再说一遍。
 */
export function FilePickerBand(props: FilePickerBandProps) {
  const { filePath, files, onSelectFile } = props
  const t = useTranslation()

  const options: FormOption[] = files.map(file => ({ value: file.path, label: file.path }))

  return (
    <div className="flex items-center gap-3 rounded-xl border border-module-border bg-card px-4 py-2.5">
      <FolderTree aria-hidden className="size-4 shrink-0 text-text-quaternary" />
      <span className="shrink-0 system-sm-medium text-text-primary">{t('clientConfig.file.title')}</span>
      {/* 同一行再说一遍路径只是重复：路径只在右侧下拉里出现一次。 */}
      <span className="hidden min-w-0 flex-1 truncate system-xs-regular text-text-tertiary lg:block">
        {t('clientConfig.file.description')}
      </span>
      {/*
        宽度与「要写入的模型」那两行下拉一致（`w-80`），几个下拉的右边界因此落在同一条竖线上；
        钉死宽度还免掉了「选到短路径时框缩一下」的抖动。
      */}
      <FormSelect
        ariaLabel={t('clientConfig.step.file')}
        className="ml-auto w-80 shrink-0"
        onValueChange={onSelectFile}
        options={options}
        value={filePath}
      />
    </div>
  )
}
