// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActivityPulse } from './activity-pulse'

describe('ActivityPulse', () => {
  it('renders nothing without an activity', () => {
    const { container } = render(<ActivityPulse activity={null} />)

    expect(container.firstElementChild).toBeNull()
  })

  it('exposes the event tone and remounts when the event key changes', () => {
    const { container, rerender } = render(
      <ActivityPulse activity={{ key: 'event-1', tone: 'warning' }} />,
    )
    const first = container.firstElementChild

    expect(first?.getAttribute('data-activity-tone')).toBe('warning')

    rerender(<ActivityPulse activity={{ key: 'event-2', tone: 'success' }} />)

    expect(container.firstElementChild).not.toBe(first)
    expect(container.firstElementChild?.getAttribute('data-activity-tone')).toBe('success')
  })
})
