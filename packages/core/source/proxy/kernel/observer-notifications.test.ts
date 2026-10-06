import { describe, expect, it, vi } from 'vitest'
import type { Observer } from '@server/proxy/contracts'
import { notifyObservers } from './observer-notifications'

/*
 * 观察者通知的隔离语义。
 *
 * 观察者只能看，不能改变转发结果。一个观察者抛错只丢掉**它自己**的记录——不能把异常
 * 送回数据面，也不能让排在它后面的观察者跟着丢失。帧管道、中继和出口交付共用这一份实现，
 * 所以这三条语义在这里钉住，就不必在三处各验一遍。
 */

function observer(id: string): Observer {
  return { id } as unknown as Observer
}

describe('notifyObservers', () => {
  it('按顺序逐个通知', () => {
    const seen: string[] = []
    const observers = [observer('a'), observer('b'), observer('c')]

    notifyObservers(observers, item => { seen.push(item.id as string) })

    expect(seen).toEqual(['a', 'b', 'c'])
  })

  it('某一个抛错不会中断后面的通知', () => {
    const seen: string[] = []
    const observers = [observer('a'), observer('b'), observer('c')]
    const notify = vi.fn((item: Observer) => {
      if (item.id === 'b') throw new Error('observer b exploded')
      seen.push(item.id as string)
    })

    notifyObservers(observers, notify)

    expect(seen).toEqual(['a', 'c'])
    expect(notify).toHaveBeenCalledTimes(3)
  })

  it('抛错不会把异常送回调用方（数据面不该被观察者拖垮）', () => {
    expect(() => notifyObservers([observer('a')], () => { throw new Error('boom') })).not.toThrow()
  })

  it('抛错时按 `[proxy] observer failed: <message>` 记一条警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    notifyObservers([observer('a')], () => { throw new Error('observer a exploded') })

    expect(warn).toHaveBeenCalledWith('[proxy] observer failed: observer a exploded')
    warn.mockRestore()
  })

  it('抛的不是 Error 时用 String 兜底，警告仍然记下', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // 不是 Error 对象时走 `String(error)` 兜底，警告同样要记下。
    notifyObservers([observer('a')], () => { throw 'plain string failure' })

    expect(warn).toHaveBeenCalledWith('[proxy] observer failed: plain string failure')
    warn.mockRestore()
  })

  it('每个抛错都单独记警告：两个失败的观察者就是两条记录', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    notifyObservers([observer('a'), observer('b')], () => { throw new Error('same failure') })

    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('空列表什么都不做', () => {
    const notify = vi.fn()

    notifyObservers([], notify)

    expect(notify).not.toHaveBeenCalled()
  })
})
