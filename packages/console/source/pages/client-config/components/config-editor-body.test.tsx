// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ClientConfigEditor, ClientConfigEditorFile } from '../hooks/use-client-config-editor'
import { ConfigEditorBody } from './config-editor-body'

/*
 * 这一层守的是「传不传 `contentActions` 会改变什么」：不传就是详情页那一套（模型卡在场、
 * 内容卡头留给内容模块自带的那颗生成），传了就是引导页那一套（没有模型卡、那一排由调用方给）。
 * 两块各自的内容由它们自己的测试守着，这里换成带 `data-testid` 的壳。
 */

vi.mock('./values-card', () => ({
  ValuesCard: () => <div data-testid="values-card" />,
}))

interface ContentModuleStubProps { actions?: ReactNode }

vi.mock('./content-module', () => ({
  ContentModule: (props: ContentModuleStubProps) => (
    <div data-testid="content-module" data-actions={String(Boolean(props.actions))}>{props.actions}</div>
  ),
}))

const file: ClientConfigEditorFile = {
  filePath: '~/.demo/settings.json',
  state: {
    clientKey: 'demo',
    filePath: '~/.demo/settings.json',
    resolvedPath: '/home/demo/.demo/settings.json',
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
}

function makeEditor(overrides: Partial<ClientConfigEditor> = {}): ClientConfigEditor {
  return {
    clientKey: 'demo',
    client: { key: 'demo', name: 'Demo' } as ClientConfigEditor['client'],
    files: [file],
    activeFilePath: file.filePath,
    selectFile: vi.fn(),
    loading: false,
    error: null,
    changeValues: vi.fn(),
    changeContent: vi.fn(),
    discardFile: vi.fn(),
    generateConfig: vi.fn(),
    generating: false,
    // 有配方：模型卡与生成按钮都该出现——开关才是这两个用例唯一在动的东西。
    canGenerate: true,
    dirtyFilePaths: [],
    saveAll: vi.fn(),
    saving: false,
    slots: 1,
    configurable: true,
    model: '',
    valuesFile: file,
    draftReset: 0,
    versions: [],
    versionsLoading: false,
    restoreVersion: vi.fn(),
    restoringId: null,
    ...overrides,
  }
}

describe('ConfigEditorBody', () => {
  it('不传 contentActions 时摆出模型卡，内容卡头那一排留给内容模块自己（详情页）', () => {
    render(<ConfigEditorBody editor={makeEditor()} />)

    expect(screen.getByTestId('values-card')).not.toBeNull()
    expect(screen.getByTestId('content-module').getAttribute('data-actions')).toBe('false')
  })

  it('传了 contentActions 就不摆模型卡，并把那一排转发到内容卡头（引导页）', () => {
    render(<ConfigEditorBody editor={makeEditor()} contentActions={<span data-testid="mine" />} />)

    expect(screen.queryByTestId('values-card')).toBeNull()
    expect(screen.getByTestId('content-module').getAttribute('data-actions')).toBe('true')
    // 调用方给的那一排被原样转发下去。
    expect(screen.getByTestId('mine')).not.toBeNull()
  })
})
