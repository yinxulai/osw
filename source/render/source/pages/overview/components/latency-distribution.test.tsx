// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LatencyDistribution } from './latency-distribution'

describe('LatencyDistribution', () => {
  it('shows an empty state without TTFT buckets', () => {
    render(<LatencyDistribution buckets={[]} />)

    expect(screen.getByText('暂无 TTFT 数据')).not.toBeNull()
  })

  it('uses the TTFT range order for the green-to-red color scale', () => {
    render(
      <LatencyDistribution
        buckets={[
          { range: '< 1s', count: 1, percent: 10 },
          { range: '1-2s', count: 2, percent: 11 },
          { range: '2-3s', count: 3, percent: 12 },
          { range: '3-5s', count: 4, percent: 13 },
          { range: '> 5s', count: 5, percent: 14 },
        ]}
      />,
    )

    const progressBars = screen.getAllByRole('progressbar')
    expect(progressBars).toHaveLength(5)
    expect(progressBars.map(bar => bar.className)).toEqual([
      expect.stringContaining('bg-success'),
      expect.stringContaining('bg-lime-500'),
      expect.stringContaining('bg-warning'),
      expect.stringContaining('bg-orange-500'),
      expect.stringContaining('bg-destructive'),
    ])
    expect(progressBars.map(bar => bar.getAttribute('aria-valuenow'))).toEqual(['10', '11', '12', '13', '14'])
  })
})
