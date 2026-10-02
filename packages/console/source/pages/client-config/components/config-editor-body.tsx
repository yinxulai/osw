import type { ReactNode } from 'react'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_ID } from '@common/schemas'
import { ValuesCard } from './values-card'
import { ContentModule } from './content-module'
import type { ClientConfigEditor } from '../hooks/use-client-config-editor'

/**
 * 「改这一个客户端的配置」那块正文的**版面**：要写进去的值（模型卡）+ 文件真正的样子（内容模块）。
 *
 * 状态与动作在 `useClientConfigEditor` 里，这里只管把它们摆出来。抽成独立组件是因为两处要用同一套版面：
 * **详情页**把它铺在页头与页脚之间当作整页正文；**引导页「接入工具」那一步**把它嵌进去，
 * 让用户不必跳到另一页就能改配置——两边看到的、能改的、会保存的都是同一份东西。
 * 写入那几件（生成 / 保存 / 撤销）由调用方决定摆在哪，经 `contentActions` 传进内容卡头；
 * 不传则由内容模块自带那一颗生成，彼此不重复。
 *
 * 调用方负责判断「现在能不能编」（文件在手、没有读失败）——那种分支属于页面（骨架、空态各有各的样子），
 * 不属于这块正文。这里假定 `editor.files` 已经就绪。
 */
export interface ConfigEditorBodyProps {
  editor: ClientConfigEditor
  /**
   * 摆到「配置内容」那张卡卡头右边的一排动作。
   *
   * 详情页不传：模型卡在场，写入动作各归其位——保存 / 撤销在页头，生成留在内容卡头自带的那一颗上。
   * 引导页传生成 / 撤销 / 保存三颗（见 `client-config-editor.tsx`）：那一步没有模型卡，
   * 三件写入动作一起收到「配置内容」的卡头上。传了就顺带关掉模型卡——引导页不选模型，
   * 一律按内置默认逻辑模型生成；内容卡头也不再自带生成按钮（同一排里不摆两颗）。
   */
  contentActions?: ReactNode
}

export function ConfigEditorBody(props: ConfigEditorBodyProps) {
  const { editor, contentActions } = props
  const { client, files, valuesFile, changeValues, draftReset, configurable } = editor

  // `files` 由调用方保证非空；再兜一道防止类型上多出来的空数组把下面的读取炸掉。
  if (!client || files.length === 0) return null

  /*
   * 模型是**整个客户端**的取舍，不是某一份文件里的字段：这张卡固定摆在各份文件之上，
   * 与标签无关。它回读的现状取自**承载模型的那份文件**（多文件客户端里，模型只声明在其中一份）。
   */
  const valuesState = valuesFile?.state ?? null

  return (
    <>
      {/*
        改一格模型值，一次落到**所有**文件上：承载模型的那份会写进去，其余文件里没有这些字段、
        预览也不会变——这样保存时不会出现「有的文件写了模型、有的没写」这种半截状态。
        `key` 的来由见 hook 里签名那段：任一文件内容一变，模型卡就重新回到文件里的现状。
      */}
      {!contentActions && configurable && valuesState !== null && (
        <ValuesCard
          key={`values|${files.map(file => `${file.filePath}:${file.state?.contentHash ?? ''}`).join('|')}|${draftReset}`}
          autoFill={valuesState.autoFill}
          clientKey={client.key}
          defaultModel={BUILT_IN_DEFAULT_LOGICAL_MODEL_ID}
          detected={valuesState.detected}
          onChange={changeValues}
        />
      )}

      {/*
        内容那块不再是「另存一份草稿」：改模型与改文字编辑的是同一段内容（每份文件各自的 `content`），
        所以两处共用同一套保存/撤销——值一改，对应文件的内容就跟着变。
      */}
      <ContentModule actions={contentActions} editor={editor} />
    </>
  )
}
