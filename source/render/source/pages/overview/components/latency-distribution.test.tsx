// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LatencyDistribution } from './latency-distribution'

describe('LatencyDistribution', () => {
  it('shows an empty state without TTFT buckets', () => {
    render(<LatencyDistribution buckets={[]} />)

    expect(screen.getByText('暂无 TTFT 数据')).not.toBeNull()
  })

  it('renders a vertical bar chart for TTFT buckets', () => {
    const { container } = render(
      <LatencyDistribution
        buckets={[
          { range: '0-100ms', count: 1, percent: 50 },
          { range: '100-200ms', count: 1, percent: 50 },
        ]}
      />,
    )

    expect(screen.queryByText('暂无 TTFT 数据')).toBeNull()
    expect(container.querySelector('[data-slot="chart"]')).not.toBeNull()
    expect(screen.queryAllByRole('progressbar')).toEqual([])
  })
})
