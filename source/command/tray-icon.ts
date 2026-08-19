import { nativeImage, NativeImage } from 'electron'
import officialIconUrl from '../../build/icon-mac.png?url'

export type TrayIconStatus = 'running' | 'stopped' | 'error'

const TRAY_ICON_SIZE = 16

/** Vite bundles the official PNG as a data URL, avoiding runtime path resolution. */
export function generateTrayIcon(status: TrayIconStatus): NativeImage {
  const source = nativeImage.createFromDataURL(officialIconUrl)
  if (source.isEmpty()) throw new Error('Unable to load the bundled tray icon')

  const icon = source.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE, quality: 'best' })
  if (process.platform === 'darwin' && status !== 'running') icon.setTemplateImage(true)
  return icon
}
