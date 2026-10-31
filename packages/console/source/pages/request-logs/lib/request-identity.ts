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

/** 省略展示时首尾各留几位。两头都留才对得上：前几位用来认厂商，后几位用来分辨同一批。 */
const ID_HEAD_LENGTH = 8
const ID_TAIL_LENGTH = 8

/**
 * 太长的编号压成「前八位…后八位」。
 *
 * 上游标识长短不一：`msg_01ABC` 这种短串原样显示，而 `021793429283122f3d3e58bfdffea9769710a7767b276c34eec1a`
 * 这种会把详情头部那一行撑开，把旁边的复制按钮挤出去。所以显示时中间省略，**复制值仍然是完整的那串**——
 * 省略号只是排版，拿去做对账的必须是原文。
 *
 * 阀值取「首+尾+省略号」再加一点余量：刚好等于首尾之和时省不出多少，不值得为它加一个省略号。
 */
export function abbreviateIdentifier(value: string): string {
  const limit = ID_HEAD_LENGTH + ID_TAIL_LENGTH + 4
  if (value.length <= limit) return value
  return `${value.slice(0, ID_HEAD_LENGTH)}…${value.slice(-ID_TAIL_LENGTH)}`
}
