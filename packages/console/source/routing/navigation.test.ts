import { describe, expect, it } from 'vitest'
import { findCurrentNavigationItem } from './navigation'

describe('findCurrentNavigationItem', () => {
  it('matches top-level pages and their detail routes', () => {
    expect(findCurrentNavigationItem('/overview')?.to).toBe('/overview')
    expect(findCurrentNavigationItem('/overview/provider-1')?.to).toBe('/overview')
    expect(findCurrentNavigationItem('/client-config/openai')?.to).toBe('/client-config')
  })

  it('does not treat a same-prefix sibling as a child route', () => {
    expect(findCurrentNavigationItem('/request-logs-extra')).toBeUndefined()
  })
})
