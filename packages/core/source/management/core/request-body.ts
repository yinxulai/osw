import type { IncomingMessage } from 'node:http'
import { CLIENT_REQUEST_ABORTED_MESSAGE } from '@common/error-codes'
import { AppError } from '@server/errors'

/**
 * 管理 API 请求体解析。
 *
 * **不设大小上限。** 这个接口只监听回环，而能走到这里的调用方都已经过了本次启动的凭证
 * （`x-osw-token`，见 `./request-guards.ts`）——他们本来就有权改配置、导出密钥。在「已经
 * 验过身份的调用方」和内存之间再插一道闸门，挡不住任何东西，却会让「导入一个大的配置包」
 * 被一个需要解释、需要调参的数字拦住。这是本地工具，不做资源消耗攻击假设——同一条判断在
 * 规则引擎里也是这么下的（见 `apps/docs/specs/request-rewrite-rules.md`）。
 *
 * 守卫在解析正文**之前**跑，所以「路由之外的人撑不爆这个进程」这条依然成立。
 */
export async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    req.on('data', chunk => {
      // `settled` 只会被「读完 / 中断 / 出错」置起，此后的分片没有接收方，丢掉即可。
      if (settled) return
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (settled) return
      settled = true

      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new AppError('INVALID_JSON', 400, 'Request body is not valid JSON', { cause: error }))
      }
    })

    req.on('aborted', () => fail(new Error(CLIENT_REQUEST_ABORTED_MESSAGE)))
    req.on('error', error => fail(error))
  })
}
