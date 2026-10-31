/**
 * 「这条请求的编号」该写谁。
 *
 * 本地 id（`req_...`）只在本进程内有意义：它是我方流水号的内部形状，拿去问上游时对方
 * 一无所知。真正能拿去对账的是**上游发给这次请求的那个标识**——同一串字符在对方的日志、
 * 工单、控制台里都能直接搜到。所以只要拿得到，就展示上游的。
 *
 * 上游标识不总是有：请求还没收到响应头时没有，有些供应商压根不回这个头，还有些只把它
 * 塞在响应体里（那要等这次尝试收尾、尝试行落库之后才读得出，见 `extractRequestIdFromBody`）。
 * 这两种情况都回退到本地 id——保留一个能用来关联运行日志的编号，好过留空。
 *
 * 只看**交付这次尝试**（`servingAttemptOf` 给出的那一条，也就是最后一次尝试），
 * 不往更早的尝试上找：故障转移里被放弃的那一次也有自己的上游标识，但它是另一条已经死掉的
 * 上游请求，拿它去搜索只会搜到无关的那一次。
 */
export interface RequestIdentity {
  /** 展示的那串编号。 */
  value: string
  /** `true` 表示这是上游分配的标识，`false` 表示回退到了本地 id。 */
  fromUpstream: boolean
}

/** 只读 `upstreamRequestId` 这一个字段，免得为了取个号去构造完整的尝试对象。 */
export interface RequestIdentityAttempt {
  upstreamRequestId: string | null
}

export function requestIdentityOf(servingAttempt: RequestIdentityAttempt | null, localId: string): RequestIdentity {
  const upstreamRequestId = servingAttempt?.upstreamRequestId
  if (typeof upstreamRequestId === 'string' && upstreamRequestId.trim()) {
    return { value: upstreamRequestId.trim(), fromUpstream: true }
  }
  return { value: localId, fromUpstream: false }
}
