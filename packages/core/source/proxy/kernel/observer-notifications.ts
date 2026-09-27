import type { Observer } from '@server/proxy/contracts'

/**
 * 通知观察者。
 *
 * 观察者只能看，不能改变转发结果。一个观察者抛错只丢掉自己的记录，不能把异常送回数据面。
 * 帧管道、中继和出口交付共用这一份实现，保证隔离语义不会三处漂移。
 */
export function notifyObservers(observers: readonly Observer[], notify: (observer: Observer) => void): void {
  for (const observer of observers) {
    try {
      notify(observer)
    } catch (error) {
      console.warn(`[proxy] observer failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
