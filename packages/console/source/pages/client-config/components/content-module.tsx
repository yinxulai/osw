import { FileCode2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from '@/i18n/provider'
import { formatBytes } from '@/lib/format-bytes'
import { formatVersionTime } from '../lib/relative-time'
import type { ClientConfigEditor, ClientConfigEditorFile } from '../hooks/use-client-config-editor'

interface ContentModuleProps {
  editor: ClientConfigEditor
}

/**
 * 配置内容模块：一个客户端可能要改**好几份**文件，所以它们摆在同一个卡片里，用标签切换。
 *
 * 为什么收进一张卡而不是「上方选文件 + 下方编辑区」两块：选文件与文件内容不是两件事，
 * 标签条本身就是「这个客户端有哪几份、此刻在看哪一份」的答案，摊成两块反而要用户来回对。
 *
 * 「保存」写的是**全部改动过的文件**——用户改了几份，一次落盘就是几份；改了的那几个标签带一个小圆点，
 * 保存前就能看清这一次会写哪些。撤销则只作用于**当前展开的那一份**（改错了哪一份就撤哪一份）。
 *
 * 标签只在多文件客户端出现：单文件客户端摆一条只有一个标签的标签条，是给「选文件」这个并不存在的
 * 选择造了个壳。
 */
export function ContentModule(props: ContentModuleProps) {
  const { editor } = props
  const { files, activeFilePath, selectFile, dirtyFilePaths, saveAll, saving, changeContent, discardFile } = editor
  const t = useTranslation()

  const active = files.find(file => file.filePath === activeFilePath) ?? files[0]
  const dirtyCount = dirtyFilePaths.length

  return (
    <Card>
      <SettingsCardHeader
        icon={<FileCode2 />}
        title={t('clientConfig.content.title')}
        // 卡头报**当前展开的**文件在磁盘上的真实路径：契约里 `resolvedPath` 就是这个意思。
        // 声明路径另有其处——那正是下面标签条上写着的 `~/` 写法。
        description={active ? <span className="font-mono">{active.state?.resolvedPath ?? active.filePath}</span> : undefined}
        actions={(
          <>
            {/* 撤销只作用于当前这份；没有改动就没什么可撤的。 */}
            <Button disabled={!active?.dirty || saving} variant="outline" onClick={() => active && discardFile(active.filePath)}>
              {t('clientConfig.discard')}
            </Button>
            {/* 保存写的是全部改动过的那几份，按钮上带上数量，点之前就知道这一次会写几份。 */}
            <Button disabled={dirtyCount === 0 || saving} onClick={saveAll}>
              {saving ? t('clientConfig.saving') : dirtyCount > 1 ? t('clientConfig.saveAll', { count: dirtyCount }) : t('clientConfig.saveContent')}
            </Button>
          </>
        )}
      />

      <Tabs value={activeFilePath} onValueChange={selectFile}>
        {/* 只有多文件客户端才摆标签条：单文件时那一条是给「选文件」造了个并不存在的壳。 */}
        {files.length > 1 && (
          <div className="px-4 pt-3">
            {/* 标准标签行为，与托盘面板同一套：列表铺满整行、标签按内容宽度从左往右排。
                两处默认值要收回来——列表自带 `justify-center`、标签自带 `flex-1`，单个文件时
                那个标签会被居中并抻满整行，像没画完的占位。文字不再另加 `overflow-x-auto`：
                横向滚动会顺带把纵向也变成 `auto`，标签条的指示条只要溢出半像素就会长出一条
                多余的纵向滚动条；标签本来就单行不换行，交给默认布局即可。 */}
            <TabsList className="w-full justify-start" aria-label={t('clientConfig.content.title')}>
              {files.map(file => (
                <TabsTrigger key={file.filePath} className="min-w-0 max-w-full flex-none overflow-hidden text-ellipsis" title={file.filePath} value={file.filePath}>
                  <span className="min-w-0 truncate">{basename(file.filePath)}</span>
                  {/* 有改动的标签带一个圆点：切到别的标签时也能一眼看出这一份还没保存。 */}
                  {file.dirty && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-state-accent-solid" />}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        )}

        {/* 一个文件一个面板，Radix 只挂载当前选中的那个：切换标签不重渲染别份的 textarea。 */}
        {files.map(file => (
          <TabsContent key={file.filePath} className="mt-0" value={file.filePath}>
            <FilePanel file={file} onChange={next => changeContent(file.filePath, next)} />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  )
}

interface FilePanelProps {
  file: ClientConfigEditorFile
  onChange: (content: string) => void
}

/** 一份文件的面板：一行元信息 + 正文文本区。内容由上层给（模型选择与手改汇到同一段）。 */
function FilePanel(props: FilePanelProps) {
  const { file, onChange } = props
  const t = useTranslation()
  const state = file.state

  if (state === null) {
    // 这份文件还没读到：给一块正文高度的占位，别让整卡塌掉。
    return <CardContent className="px-4 pt-3"><div className="h-72 w-full animate-pulse rounded-lg bg-inset" /></CardContent>
  }

  return (
    <CardContent className="space-y-2 px-4 pt-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 system-xs-regular text-text-tertiary">
        <span className={state.exists ? undefined : 'text-text-quaternary'}>
          {state.exists ? t('clientConfig.content.exists') : t('clientConfig.content.missing')}
        </span>
        {/* 文件不在就一律留 `—`：这里报什么都是「没有」，写 0 B 会让人以为文件在那儿但是空的。 */}
        <span>
          {t('clientConfig.content.size')}{' '}
          <span className="font-mono text-text-secondary">
            {state.exists ? formatBytes(state.sizeBytes) : t('clientConfig.emptyValue')}
          </span>
        </span>
        <span>
          {t('clientConfig.content.modified')}{' '}
          <span className="font-mono text-text-secondary">
            {state.modifiedTime ? formatVersionTime(t, state.modifiedTime) : t('clientConfig.emptyValue')}
          </span>
        </span>
      </div>

      <Textarea
        aria-label={basename(file.filePath)}
        className="min-h-72 font-mono"
        placeholder={t('clientConfig.content.placeholder')}
        spellCheck={false}
        value={file.content}
        onChange={event => onChange(event.target.value)}
      />
    </CardContent>
  )
}

/** 标签上用文件名的最后一段：整条路径太长，同目录的几份文件靠文件名就能分清。 */
function basename(filePath: string): string {
  const segments = filePath.split('/')
  return segments[segments.length - 1] ?? filePath
}
