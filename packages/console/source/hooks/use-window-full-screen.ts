import { useEffect, useState } from 'react'
import { getPlatformCapabilities } from '@/platform/capabilities'

export function useWindowFullScreen(): boolean {
  const [fullScreen, setFullScreen] = useState(false)

  useEffect(() => {
    const { getFullScreenState, onFullScreenChanged } = getPlatformCapabilities()
    let active = true
    const unsubscribe = onFullScreenChanged?.(value => {
      if (active) setFullScreen(value)
    })
    if (getFullScreenState) {
      void getFullScreenState()
        .then(value => {
          if (active) setFullScreen(value)
        })
        .catch(error => {
          console.error('[window-full-screen] failed to read initial state', error)
        })
    }
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  return fullScreen
}
