// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { RulesTable } from './rules-table'

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps {
  children: ReactNode
}

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

function renderTable(overrides: Partial<Parameters<typeof RulesTable>[0]> = {}) {
  const onCreate = vi.fn()
  const onClearFilters = vi.fn()
  render(
    <Wrapper>
      <RulesTable
        rules={[]}
        search=""
        statusFilter="all"
        hasAnyRules={false}
        onSearchChange={() => {}}
        onStatusFilterChange={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onToggle={() => {}}
        onCreate={onCreate}
        onClearFilters={onClearFilters}
        {...overrides}
      />
    </Wrapper>,
  )
  return { onCreate, onClearFilters }
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
})

afterEach(() => {
  cleanup()
})

describe('RulesTable 的空态', () => {
  it('一条规则都没有时给出「新建规则」行动入口', () => {
    const { onCreate } = renderTable()

    expect(screen.getByText('还没有请求重写规则')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新建规则' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('筛选后为空时提示清除筛选，而不是误报「没有规则」', () => {
    const { onClearFilters } = renderTable({ hasAnyRules: true, search: 'missing' })

    expect(screen.getByText('没有匹配的规则')).toBeTruthy()
    expect(screen.queryByText('还没有请求重写规则')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(onClearFilters).toHaveBeenCalledTimes(1)
  })
})
