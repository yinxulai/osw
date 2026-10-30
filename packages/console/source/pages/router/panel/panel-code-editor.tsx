import { useEffect, useMemo, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import type { SchemaFieldDescriptor } from '@common/router/types'
import { buildExtensions, type PanelCodeLanguage } from './panel-code-completions'

/**
 * 面板里的代码编辑器。
 *
 * 为什么用 CodeMirror 而不是「textarea 叠一层高亮 `<pre>`」：高亮层只能做上色，
 * 而 JS 脚本要的是真代码提示（候选、键盘选择、按光标位置插入），这需要编辑器知道
 * 文档结构与光标坐标 —— 手写那套的成本远高于引入 CodeMirror。提示词模板只用到它的
 * 正则打标记能力，两种模式因此共用同一套外观与交互。
 *
 * CodeMirror 的装配（主题、补全源、装饰）都在 `./panel-code-completions`（零 React）；
 * 这个组件只负责创建 `EditorView`、把 props 喂进去、在外部重置时写回文档。
 */

export interface PanelCodeEditorProps {
  value: string
  language: PanelCodeLanguage
  /** 上游 schema 推出的可用字段，用于补全候选与变量标记 */
  fields: SchemaFieldDescriptor[]
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  maxHeight?: number
  className?: string
}


export function PanelCodeEditor(props: PanelCodeEditorProps) {
  const { value, language, fields, onChange, placeholder, minHeight = 160, maxHeight, className } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fieldsRef = useRef(fields)
  const changeRef = useRef(onChange)
  const valueRef = useRef(value)
  const t = useTranslation()

  useEffect(() => {
    fieldsRef.current = fields
    changeRef.current = onChange
    valueRef.current = value
  }, [fields, onChange, value])

  const extensions = useMemo(
    () => buildExtensions({ language, fields: fieldsRef, onChange: changeRef, placeholder, t }),
    [language, placeholder, t],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: valueRef.current, extensions }),
    })
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [extensions])

  // 外部重置（切换节点、恢复版本）才需要写回文档；用户输入时这里始终是 no-op。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return (
    <div
      ref={hostRef}
      className={cn('panel-code-editor flex flex-col', className)}
      style={{ minHeight, ...(maxHeight === undefined ? {} : { maxHeight }) }}
    />
  )
}
