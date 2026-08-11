/**
 * 系统钥匙串封装
 *
 * 设计目标：API Key 等敏感信息不存储在数据库中，只存一个 reference ID。
 * MVP 阶段：使用 Electron 的 safeStorage + 本地文件（加密存储）。
 * 未来可以替换为系统原生 keychain（keytar 等）。
 */

// 运行时注入：主进程通过 preload 暴露 keychain API
// 这里只定义类型和接口，具体实现在 command 层（Electron 主进程）

export interface KeychainApi {
  set(reference: string, value: string): Promise<void>
  get(reference: string): Promise<string | null>
  delete(reference: string): Promise<void>
}

// 生成 key reference ID
export function generateKeyReference(prefix = 'key_'): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
