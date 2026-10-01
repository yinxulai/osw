import { BUILT_IN_DEFAULT_LOGICAL_MODEL_ID } from '@common/schemas'
import { FilePickerBand } from './file-picker-band'
import { ValuesCard } from './values-card'
import { ContentCard } from './content-card'
import type { ClientConfigEditor } from '../hooks/use-client-config-editor'

/**
 * 「改这一个客户端的配置」那三块内容的**版面**：选哪份文件（前提带，只有多文件客户端才摆）、
 * 要写进去的值（模型卡）、文件真正的样子（内容卡）。
 *
 * 状态与动作在 `useClientConfigEditor` 里，这里只管把它们摆出来。抽成独立组件是因为两处要用同一套版面：
 * **详情页**把它铺在页头与页脚之间当作整页正文；**引导页「接入工具」那一步**把它嵌进去，
 * 让用户不必跳到另一页就能改配置——两边看到的、能改的、会保存的都是同一份东西，
 * 只是详情页在上面还挂了一条「一键生效 / 版本历史」的页头动作，引导页没有。
 *
 * 调用方负责判断「现在能不能编」（文件在手、没有读失败）——那种分支属于页面（骨架、空态各有各的样子），
 * 不属于这块正文。这里假定 `editor.state` 已经就绪。
 */
export interface ConfigEditorBodyProps {
  editor: ClientConfigEditor
}

export function ConfigEditorBody(props: ConfigEditorBodyProps) {
  const {
    clientKey,
    client,
    filePath,
    selectFile,
    state,
    stateKey,
    content,
    changeValues,
    changeContent,
    discardChanges,
    saveContent,
    saving,
    draftReset,
    configurable,
  } = props.editor

  // `state` 由调用方保证非空；再兜一道防止类型上多出来的 `null` 把下面的读取炸掉。
  if (!client || !state) return null

  return (
    <>
      {/* 只有多文件客户端才需要这一步；单文件时路径在内容卡片里已经写着。 */}
      {client.files.length > 1 && <FilePickerBand filePath={filePath} files={client.files} onSelectFile={selectFile} />}

      {/* `key` 的来由见 hook 里 `stateKey`：内容一变，表单重新回到文件里的现状。 */}
      {configurable && (
        <ValuesCard
          key={`values|${stateKey}|${draftReset}`}
          autoFill={state.autoFill}
          clientKey={clientKey}
          defaultModel={BUILT_IN_DEFAULT_LOGICAL_MODEL_ID}
          detected={state.detected}
          onChange={changeValues}
        />
      )}

      {/*
        内容那块不再是「另存一份草稿」：上面改模型与这里改文字编辑的是同一段内容（`content`），
        所以两处共用一套保存/撤销，「写入文件」那一颗因此没有了必要——值一改，这里就跟着变。
      */}
      <ContentCard
        key={`content|${stateKey}`}
        saving={saving}
        state={state}
        value={content}
        onChange={changeContent}
        onDiscard={discardChanges}
        onSave={saveContent}
      />
    </>
  )
}
