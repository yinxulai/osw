// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ClientConfigEditor, ClientConfigEditorFile } from '../hooks/use-client-config-editor'
import { ContentModule } from './content-module'

/*
 * 内容模块是**纯展示**的：它把 `editor` 算好的状态摆出来，把用户的动作转回 `editor` 的回调。
 * 所以这里给一个手搭的 `editor`，断言的是版面行为——多文件才会有标签条、改了的那份带圆点、
 * 「保存」按钮上的文案随改动份数变化、撤销只退当前份。
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

  it('labels a single change as a plain save', () => {
    render(<ContentModule editor={makeEditor({ dirtyFilePaths: ['~/.demo/settings.json'] })} />)

    expect(screen.getByRole('button', { name: 'clientConfig.saveContent' })).toBeTruthy()
  })

  it('counts the changed files on the save-all button', () => {
    render(<ContentModule editor={makeEditor({ dirtyFilePaths: ['~/.demo/settings.json', '~/.demo/credentials.json'] })} />)

    expect(screen.getByRole('button', { name: 'clientConfig.saveAll#{"count":2}' })).toBeTruthy()
  })

  it('writes every changed file when save is pressed', () => {
    const editor = makeEditor({ dirtyFilePaths: ['~/.demo/settings.json', '~/.demo/credentials.json'] })
    render(<ContentModule editor={editor} />)

    fireEvent.click(screen.getByRole('button', { name: 'clientConfig.saveAll#{"count":2}' }))
    expect(editor.saveAll).toHaveBeenCalledTimes(1)
  })

  it('disables save while there is nothing to save', () => {
    render(<ContentModule editor={makeEditor()} />)

    const save = screen.getByRole('button', { name: 'clientConfig.saveContent' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('discards only the file currently in view', () => {
    const editor = makeEditor({ dirtyFilePaths: ['~/.demo/settings.json'], files: [file({ filePath: '~/.demo/settings.json', dirty: true }), file({ filePath: '~/.demo/credentials.json' })], activeFilePath: '~/.demo/settings.json' })
    render(<ContentModule editor={editor} />)

    fireEvent.click(screen.getByRole('button', { name: 'clientConfig.discard' }))
    expect(editor.discardFile).toHaveBeenCalledWith('~/.demo/settings.json')
  })

  it('edits the content of the file in view', () => {
    const editor = makeEditor()
    render(<ContentModule editor={editor} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'settings.json' }), { target: { value: '{"model":"gpt"}' } })
    expect(editor.changeContent).toHaveBeenCalledWith('~/.demo/settings.json', '{"model":"gpt"}')
  })
})
