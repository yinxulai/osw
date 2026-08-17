import { nativeImage, NativeImage } from 'electron'

/**
 * 生成托盘图标（纯代码生成，不依赖外部资源文件）
 * 使用 16x16 像素的简单开关图标
 */

// 颜色定义
const COLORS = {
  running: {
    fg: '#22c55e', // green-500
    bg: '#1f2937', // gray-800
  },
  stopped: {
    fg: '#6b7280', // gray-500
    bg: '#1f2937', // gray-800
  },
  error: {
    fg: '#ef4444', // red-500
    bg: '#1f2937', // gray-800
  },
}

export type TrayIconStatus = 'running' | 'stopped' | 'error'

/**
 * 生成 16x16 的托盘图标 PNG
 * 设计：圆角方形背景 + 电源开关符号
 */
export function generateTrayIcon(status: TrayIconStatus): NativeImage {
  const colors = COLORS[status]
  const size = 16

  // 创建 PNG 数据（手动构造 16x16 RGBA 像素）
  const pixels = Buffer.alloc(size * size * 4)

  // 绘制圆角方形背景
  const bgColor = hexToRgba(colors.bg)
  const fgColor = hexToRgba(colors.fg)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4

      // 圆角方形（半径 3）
      const inRoundedRect = isInRoundedRect(x, y, 0, 0, size, size, 3)

      if (inRoundedRect) {
        pixels[idx] = bgColor.r
        pixels[idx + 1] = bgColor.g
        pixels[idx + 2] = bgColor.b
        pixels[idx + 3] = 255
      } else {
        pixels[idx + 3] = 0 // 透明
      }
    }
  }

  // 绘制电源开关符号（简化版）
  // 竖线 + 半圆
  const cx = size / 2
  const cy = size / 2

  // 竖线（从中心向上）
  for (let y = 4; y <= 9; y++) {
    const x = Math.floor(cx)
    if (x >= 0 && x < size && y >= 0 && y < size) {
      const idx = (y * size + x) * 4
      pixels[idx] = fgColor.r
      pixels[idx + 1] = fgColor.g
      pixels[idx + 2] = fgColor.b
      pixels[idx + 3] = 255
    }
    // 线宽 2
    const x2 = Math.floor(cx) + 1
    if (x2 >= 0 && x2 < size && y >= 0 && y < size) {
      const idx = (y * size + x2) * 4
      pixels[idx] = fgColor.r
      pixels[idx + 1] = fgColor.g
      pixels[idx + 2] = fgColor.b
      pixels[idx + 3] = 255
    }
  }

  // 半圆（开口向上，从左下到右下）
  const arcRadius = 4
  const arcCy = cy + 1
  for (let angle = Math.PI; angle <= 2 * Math.PI; angle += 0.1) {
    const px = Math.round(cx + arcRadius * Math.cos(angle))
    const py = Math.round(arcCy + arcRadius * Math.sin(angle))
    if (px >= 0 && px < size && py >= 0 && py < size) {
      const idx = (py * size + px) * 4
      pixels[idx] = fgColor.r
      pixels[idx + 1] = fgColor.g
      pixels[idx + 2] = fgColor.b
      pixels[idx + 3] = 255
    }
  }

  return nativeImage.createFromBuffer(pixels, { width: size, height: size })
}

function hexToRgba(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 }
}

function isInRoundedRect(
  x: number,
  y: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  radius: number,
): boolean {
  // 检查是否在矩形主体内
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false

  // 检查四个角
  const left = rx + radius
  const right = rx + rw - radius - 1
  const top = ry + radius
  const bottom = ry + rh - radius - 1

  // 如果在中间区域，直接返回 true
  if (x >= left && x <= right) return true
  if (y >= top && y <= bottom) return true

  // 检查四个圆角
  const corners = [
    { cx: left, cy: top }, // 左上
    { cx: right, cy: top }, // 右上
    { cx: left, cy: bottom }, // 左下
    { cx: right, cy: bottom }, // 右下
  ]

  for (const corner of corners) {
    const dx = x - corner.cx
    const dy = y - corner.cy
    if (dx * dx + dy * dy <= radius * radius) return true
  }

  return false
}
