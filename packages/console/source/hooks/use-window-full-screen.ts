import { useEffect, useState } from 'react'
import { getPlatformCapabilities } from '@/platform/capabilities'

export function useWindowFullScreen(): boolean {
  const [fullScreen, setFullScreen] = useState(false)

  useEffect(() => {
    const capabilities = getPlatformCapabilities()
    let active = true
    void capabilities.getFullScreenState?.().then(value => {
      if (active) setFullScreen(value)
    }).catch(() => {})
    const unsubscribe = capabilities.onFullScreenChanged?.(setFullScreen)
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  return fullScreen
}
