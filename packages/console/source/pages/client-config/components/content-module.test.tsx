// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ClientConfigEditor, ClientConfigEditorFile } from '../hooks/use-client-config-editor'
import { ContentModule } from './content-module'

/*
 * 内容模块是**纯展示**的：它把 `editor` 算好的状态摆出来，把用户的动作转回 `editor` 的回调。
 * 所以这里给一个手搭的 `editor`，断言的是版面行为——多文件才会有标签条、改了的那份带圆点、
 * 「生成配置」按钮只在有配方的客户端出现、点它转回 `generateConfig`。
 *
 * 保存与撤销不在这里：它们是整页（或整张卡）的写入动作，摆在页头，由各自的页面负责。
 */

vi.mock('@/i18n/provider', () => ({
  useTranslation: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}#${JSON.stringify(params)}` : key),
}))

type FileOverrides = Partial<ClientConfigEditorFile> & { filePath: string }

function file(overrides: FileOverrides): ClientConfigEditorFile {
  return {
    state: {
      clientKey: 'demo',
      filePath: overrides.filePath,
      resolvedPath: overrides.filePath.replace('~', '/home/demo'),
      format: 'json',
      exists: true,
      content: '{}',
      contentHash: 'h',
      sizeBytes: 2,
      modifiedTime: null,
      autoFill: 'ready',
      detected: {},
    },
    loading: false,
    error: null,
    content: '{}',
    dirty: false,
    ...overrides,
  }
}

function makeEditor(overrides: Partial<ClientConfigEditor> = {}): ClientConfigEditor {
  const files = [
    file({ filePath: '~/.demo/settings.json' }),
    file({ filePath: '~/.demo/credentials.json' }),
  ]
  return {
    clientKey: 'demo',
    client: undefined,
    files,
    activeFilePath: '~/.demo/settings.json',
    selectFile: vi.fn(),
    loading: false,
    error: null,
    changeValues: vi.fn(),
    changeContent: vi.fn(),
    discardFile: vi.fn(),
    generateConfig: vi.fn(),
    generating: false,
    canGenerate: true,
    dirtyFilePaths: [],
    saveAll: vi.fn(),
    saving: false,
    slots: 0,
    configurable: false,
    model: '',
    valuesFile: files[0],
    draftReset: 0,
    versions: [],
    versionsLoading: false,
    restoreVersion: vi.fn(),
    restoringId: null,
    ...overrides,
  }
}

describe('ContentModule', () => {
  it('shows a tab per file so the user can tell the client has more than one', () => {
    render(<ContentModule editor={makeEditor()} />)

    // 标签用文件名最后一段。
    expect(screen.getByRole('tab', { name: /settings\.json/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /credentials\.json/ })).toBeTruthy()
  })

  it('does not show a tab strip for a single-file client', () => {
    render(<ContentModule editor={makeEditor({ files: [file({ filePath: '~/.demo/only.json' })], activeFilePath: '~/.demo/only.json' })} />)

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('asks the editor to switch files when another tab is clicked', () => {
    const editor = makeEditor()
    render(<ContentModule editor={editor} />)

    fireEvent.mouseDown(screen.getByRole('tab', { name: /credentials\.json/ }))
    expect(editor.selectFile).toHaveBeenCalledWith('~/.demo/credentials.json')
  })

  it('marks only the files that changed as dirty', () => {
    const files = [
      file({ filePath: '~/.demo/settings.json', dirty: true }),
      file({ filePath: '~/.demo/credentials.json' }),
    ]
    render(<ContentModule editor={makeEditor({ files, activeFilePath: '~/.demo/settings.json', dirtyFilePaths: ['~/.demo/settings.json'] })} />)

    // 有改动的那份带圆点；另一份没有。
    const dirtyDot = screen.getByRole('tab', { name: /settings\.json/ }).querySelector('.bg-state-accent-solid')
    expect(dirtyDot).not.toBeNull()
    const cleanDot = screen.getByRole('tab', { name: /credentials\.json/ }).querySelector('.bg-state-accent-solid')
    expect(cleanDot).toBeNull()
  })

  it('offers to generate the config only when the client has a recipe', () => {
    // 有配方（`canGenerate`）才摆生成按钮：没有配方就没有推荐内容可生成。
    render(<ContentModule editor={makeEditor({ canGenerate: true })} />)
    expect(screen.getByRole('button', { name: 'clientConfig.generate' })).toBeTruthy()
  })

  it('hides the generate button when there is nothing to generate', () => {
    render(<ContentModule editor={makeEditor({ canGenerate: false })} />)
    expect(screen.queryByRole('button', { name: 'clientConfig.generate' })).toBeNull()
  })

  it('uses the actions the caller passes instead of its own generate button', () => {
    // 引导页把「生成 / 撤销 / 保存」整排传进来：卡头就摆那一排，不再自带生成。
    render(<ContentModule editor={makeEditor({ canGenerate: true })} actions={<button type="button">custom-action</button>} />)

    expect(screen.getByRole('button', { name: 'custom-action' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'clientConfig.generate' })).toBeNull()
  })

  it('asks the editor to generate the config when pressed', () => {
    const editor = makeEditor({ canGenerate: true })
    render(<ContentModule editor={editor} />)

    fireEvent.click(screen.getByRole('button', { name: 'clientConfig.generate' }))
    expect(editor.generateConfig).toHaveBeenCalledTimes(1)
  })

  it('disables generate while a generation is running', () => {
    render(<ContentModule editor={makeEditor({ canGenerate: true, generating: true })} />)

    const generate = screen.getByRole('button', { name: 'clientConfig.generating' }) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
  })

  it('edits the content of the file in view', () => {
    const editor = makeEditor()
    render(<ContentModule editor={editor} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'settings.json' }), { target: { value: '{"model":"gpt"}' } })
    expect(editor.changeContent).toHaveBeenCalledWith('~/.demo/settings.json', '{"model":"gpt"}')
  })
})
