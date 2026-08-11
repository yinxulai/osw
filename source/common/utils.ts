// 通用工具函数

export function generateId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  return `${prefix}${random}`
}

export function now(): number {
  return Date.now()
}
