import type { Protocol } from '@common/schemas'

export type ConversionDirection = 'request' | 'response'
export type ConversionPhase = 'whole-body' | 'stream-chunk' | 'stream-finish'

/**
 * 协议转换失败。
 *
 * 这是一条可归因的数据面失败，不是「转换器的内部小错误」：调用方必须让这次尝试失败，
 * 绝不能把未转换的上游原文冒充成客户端协议成功返回。
 */
export class ProtocolConversionError extends Error {
  readonly code = 'PROTOCOL_CONVERSION_FAILED'

  constructor(readonly direction: ConversionDirection, readonly phase: ConversionPhase, readonly from: Protocol, readonly to: Protocol, cause: unknown) {
    super(`Failed to convert ${direction} response from ${from} to ${to} during ${phase}: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'ProtocolConversionError'
    this.cause = cause
  }
}
