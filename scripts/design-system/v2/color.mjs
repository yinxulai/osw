/**
 * OKLCH / sRGB / WCAG 2.2 对比度工具。
 *
 * v2 的所有色值都先以 OKLCH 三元组声明，再由这里换算成 sRGB hex。
 * 产物里同时保留 `oklch()` 与 hex：前者是设计源，后者是浏览器与守卫的核对基准。
 * 对比度一律按 WCAG 相对亮度计算（sRGB，D65），先合成 alpha 再比。
 */

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))

export const oklchToRgb = (l, c, h) => {
  const radians = (h * Math.PI) / 180
  const a = c * Math.cos(radians)
  const b = c * Math.sin(radians)
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b
  const l3 = lPrime ** 3
  const m3 = mPrime ** 3
  const s3 = sPrime ** 3
  const red = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const green = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const blue = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  const encode = value => {
    const v = clamp(value)
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  }
  return [encode(red), encode(green), encode(blue)].map(channel => Math.round(channel * 255))
}

export const rgbToOklch = rgb => {
  const decode = value => {
    const v = value / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgb.map(decode)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const lPrime = Math.cbrt(l)
  const mPrime = Math.cbrt(m)
  const sPrime = Math.cbrt(s)
  const L = 0.2104542553 * lPrime + 0.793617785 * mPrime - 0.0040720468 * sPrime
  const a = 1.9779984951 * lPrime - 2.428592205 * mPrime + 0.4505937099 * sPrime
  const bb = 0.0259040371 * lPrime + 0.7827717662 * mPrime - 0.808675766 * sPrime
  return { l: L, c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 }
}

export const hexToRgb = hex => {
  const clean = hex.replace('#', '')
  return [0, 2, 4].map(index => Number.parseInt(clean.slice(index, index + 2), 16))
}

export const rgbToHex = rgb => `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`

export const hex = (l, c, h) => rgbToHex(oklchToRgb(l, c, h))

const channelLuminance = value => {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

export const luminance = rgb =>
  0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2])

export const contrast = (foreground, background) => {
  const a = luminance(foreground)
  const b = luminance(background)
  return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2))
}

export const contrastHex = (foreground, background) => contrast(hexToRgb(foreground), hexToRgb(background))

export const mix = (top, bottom, alpha) => {
  const t = hexToRgb(top)
  const b = hexToRgb(bottom)
  return rgbToHex([0, 1, 2].map(index => Math.round(t[index] * alpha + b[index] * (1 - alpha))))
}

/** 生成一个 12 阶色阶：L 与 C 由数组给出，H 固定。 */
export const ramp = (name, hue, steps) => steps.map(([l, c], index) => ({
  name: `${name}-${index + 1}`,
  step: index + 1,
  l,
  c,
  h: hue,
  hex: hex(l, c, hue),
  oklch: `oklch(${l.toFixed(3)} ${c.toFixed(4)} ${hue.toFixed(2)})`,
}))

export const token = (name, l, c, h, meta = {}) => ({
  name,
  l,
  c,
  h,
  hex: hex(l, c, h),
  oklch: `oklch(${l.toFixed(3)} ${c.toFixed(4)} ${h.toFixed(2)})`,
  ...meta,
})
