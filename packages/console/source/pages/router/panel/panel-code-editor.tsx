import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript'
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  placeholder as placeholderExtension,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'

import { cn } from '@/lib/utils'
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import type { SchemaFieldDescriptor } from '@common/router/types'

/**
 * 面板里的代码编辑器。
 *
 * 为什么用 CodeMirror 而不是「textarea 叠一层高亮 `<pre>`」：高亮层只能做上色，
 * 而 JS 脚本要的是真代码提示（候选、键盘选择、按光标位置插入），这需要编辑器知道
 * 文档结构与光标坐标 —— 手写那套的成本远高于引入 CodeMirror。提示词模板只用到它的
 * 正则打标记能力，两种模式因此共用同一套外观与交互。
 *
 * 外观全部写进 `EditorView.theme` / `HighlightStyle`（颜色一律取 CSS 变量），
 * 所以自动跟随明暗主题，也不需要在 `styles/index.css` 里再开一套 CodeMirror 选择器。
 */
export type PanelCodeLanguage = 'javascript' | 'template'

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

const PANEL_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.modifier], color: 'var(--color-util-colors-violet-violet-500)' },
  { tag: [tags.atom, tags.bool, tags.null, tags.number, tags.url, tags.labelName], color: 'var(--color-util-colors-pink-pink-500)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-util-colors-green-green-500)' },
  { tag: [tags.regexp, tags.escape], color: 'var(--color-util-colors-warning-warning-500)' },
  { tag: [tags.typeName, tags.namespace, tags.className], color: 'var(--color-util-colors-cyan-cyan-500)' },
  { tag: [tags.definition(tags.variableName), tags.local(tags.variableName), tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: 'var(--color-util-colors-blue-blue-500)' },
  { tag: [tags.definition(tags.propertyName)], color: 'var(--color-text-primary)' },
  { tag: [tags.comment], color: 'var(--color-text-tertiary)', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--color-text-secondary)' },
  { tag: [tags.meta], color: 'var(--color-text-quaternary)' },
  { tag: [tags.invalid], color: 'var(--color-text-destructive)' },
])

const PANEL_EDITOR_THEME = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '12px', color: 'var(--color-components-input-text-filled)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px', overflowY: 'auto' },
  '.cm-content': { padding: '7px 12px', caretColor: 'var(--color-text-primary)' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-placeholder': { color: 'var(--color-components-input-text-placeholder)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-text-primary)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--color-state-base-active)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--color-state-base-active)' },
  // 补全弹层：沿用项目里浮层那一套（0.5px 描边 + 半透明面板底 + 5px 背景模糊），
  // 不用 CodeMirror 自带的浅色皮肤。
  '.cm-tooltip': {
    border: '0.5px solid var(--color-components-panel-border)',
    borderRadius: '8px',
    backgroundColor: 'var(--color-components-panel-bg-blur)',
    backdropFilter: 'blur(5px)',
    color: 'var(--color-text-primary)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { padding: '4px', maxHeight: '240px', fontFamily: 'inherit', fontSize: '12px', lineHeight: '18px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 6px', borderRadius: '6px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--color-state-base-hover-alt)', color: 'var(--color-text-primary)' },
  '.cm-tooltip.cm-completionInfo': { padding: '6px 8px', maxWidth: '240px', fontSize: '11px', lineHeight: '16px', color: 'var(--color-text-secondary)' },
  '.cm-completionDetail': { marginLeft: '8px', fontSize: '11px', fontStyle: 'normal', color: 'var(--color-text-quaternary)' },
  '.cm-completionMatchedText': { fontWeight: '600', textDecoration: 'none', color: 'var(--color-text-accent)' },
})

/** `get('路径')` 里正在写字符串：补全候选是字段路径。 */
const SCRIPT_GET_CALL = /\bget\(\s*(['"])[^'"]*$/
/** `payload.route.` 这种成员访问：补全候选同样是字段路径。 */
const SCRIPT_PAYLOAD_ACCESS = /\bpayload(?:\.[\w[\]]*)*\.?$/
/** 提示词模板里正在写的 `${...}`。与引擎 `renderTemplate` 的正则保持一致。 */
const TEMPLATE_VARIABLE = /\$\{[^}]*$/

function scriptGlobalCompletions(t: AppTranslator): Completion[] {
  return [
    { label: 'payload', type: 'variable', detail: t('router.panel.completion.payloadDetail') },
    snippetCompletion("get('${0}')", { label: 'get(...)', type: 'function', detail: t('router.panel.completion.getValueDetail') }),
    snippetCompletion('console.log(${0})', { label: 'console.log(...)', type: 'function', detail: t('router.panel.completion.consoleLogDetail') }),
  ]
}

/** 提示词模板里 `${变量}` 的标记。只做上色，不参与语法解析。 */
const templateVariableMatcher = new MatchDecorator({
  regexp: /\$\{[^}]*\}/g,
  decoration: Decoration.mark({ class: 'panel-code-variable' }),
})

class TemplateVariableHighlighter {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = templateVariableMatcher.createDeco(view)
  }

  update(update: ViewUpdate) {
    this.decorations = templateVariableMatcher.updateDeco(update, this.decorations)
  }
}

/** 用字段路径生成一条候选；`closer` 是插入后需要补齐的收尾字符（引号或 `}`）。 */
function fieldCompletion(field: SchemaFieldDescriptor, closer: string): Completion {
  return {
    label: field.path,
    detail: field.valueType,
    info: field.note,
    type: 'property',
    // 因为要判断「收尾字符是否已经存在」，这里用函数形式的 apply 而不是字符串模板。
    apply: (view, _completion, from, to) => {
      const next = view.state.sliceDoc(to, Math.min(to + 1, view.state.doc.length))
      const insert = next === closer ? field.path : `${field.path}${closer}`
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } })
    },
  }
}

/** JS 脚本的候选源：`get('...')` / `payload.` 给字段路径，普通标识符给沙箱内置。 */
function createScriptCompletionSource(fields: MutableRefObject<SchemaFieldDescriptor[]>, t: AppTranslator) {
  return (context: CompletionContext): CompletionResult | null => {
    const optionFields = fields.current.map(field => fieldCompletion(field, "'"))

    const getCall = context.matchBefore(SCRIPT_GET_CALL)
    if (getCall && optionFields.length) {
      const quoteIndex = getCall.text.search(/['"]/)
      return { from: getCall.from + quoteIndex + 1, options: optionFields, validFor: /^[^'"]*$/ }
    }

    const payloadAccess = context.matchBefore(SCRIPT_PAYLOAD_ACCESS)
    if (payloadAccess && optionFields.length) {
      return { from: payloadAccess.from, options: optionFields, validFor: /^[\w.[\]*]*$/ }
    }

    const word = context.matchBefore(/[A-Za-z_$][\w$]*$/)
    if (!word || (word.from === word.to && !context.explicit)) return null
    return { from: word.from, options: scriptGlobalCompletions(t), validFor: /^[\w$]*$/ }
  }
}

/** 提示词模板的候选源：只在 `${` 之后给字段路径，插入时补上 `}`。 */
function createTemplateCompletionSource(fields: MutableRefObject<SchemaFieldDescriptor[]>) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(TEMPLATE_VARIABLE)
    const optionFields = fields.current.map(field => fieldCompletion(field, '}'))
    if (!match || !optionFields.length) return null
    return { from: match.from + 2, options: optionFields, validFor: /^[^}]*$/ }
  }
}

interface EditorRuntime {
  language: PanelCodeLanguage
  fields: MutableRefObject<SchemaFieldDescriptor[]>
  onChange: MutableRefObject<(value: string) => void>
  placeholder: string | undefined
  t: AppTranslator
}

/** 只声明我们真正会传的字段，避免依赖 autocomplete 未导出的配置类型。 */
interface EditorCompletionOptions {
  icons: boolean
  override?: CompletionSource[]
}

function buildExtensions(runtime: EditorRuntime): Extension[] {
  const { language, fields, onChange, placeholder, t } = runtime
  const completionOptions: EditorCompletionOptions = { icons: false }
  // 模板没有语言包，只能整块覆盖候选源；JS 走 language data，不能 override。
  if (language === 'template') completionOptions.override = [createTemplateCompletionSource(fields)]
  const extensions: Extension[] = [
    history(),
    bracketMatching(),
    closeBrackets(),
    EditorView.lineWrapping,
    syntaxHighlighting(PANEL_HIGHLIGHT_STYLE),
    PANEL_EDITOR_THEME,
    // completionKeymap 必须排在 defaultKeymap 前面，否则回车会先被「插入换行」吃掉。
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange.current(update.state.doc.toString())
    }),
    EditorView.contentAttributes.of({
      'aria-label': language === 'javascript'
        ? t('router.panel.scriptEditorAria')
        : t('router.panel.templateEditorAria'),
    }),
  ]

  if (language === 'javascript') {
    extensions.push(
      autocompletion(completionOptions),
      javascript(),
      // 语言自带的补全源（局部变量、成员访问）走 language data，不能被 override 顶掉。
      javascriptLanguage.data.of({ autocomplete: createScriptCompletionSource(fields, t) }),
    )
  } else {
    extensions.push(
      autocompletion(completionOptions),
      ViewPlugin.fromClass(TemplateVariableHighlighter, { decorations: value => value.decorations }),
    )
  }

  if (placeholder) extensions.push(placeholderExtension(placeholder))
  return extensions
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
