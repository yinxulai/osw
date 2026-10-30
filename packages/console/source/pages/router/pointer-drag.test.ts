import { describe, expect, it } from 'vitest'
import { startPointerDrag, type PointerPosition } from './pointer-drag'

/** 一个最小的事件源替身：手动派发 pointermove / pointerup。 */
function fakeTarget() {
  const listeners = new Map<string, Set<EventListener>>()
  return {
    addEventListener: (type: string, listener: EventListener) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener)
    },
    emit: (type: string, position: PointerPosition) => {
      for (const listener of listeners.get(type) ?? []) listener({ clientX: position.x, clientY: position.y } as PointerEvent)
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  }
}

describe('startPointerDrag', () => {
  it('reports every move position and cleans up on pointerup', () => {
    const target = fakeTarget()
    const moves: PointerPosition[] = []
    let ended = 0
    startPointerDrag({ target, onMove: p => moves.push(p), onEnd: () => { ended += 1 } })

    target.emit('pointermove', { x: 10, y: 20 })
    target.emit('pointermove', { x: 15, y: 25 })
    expect(moves).toEqual([{ x: 10, y: 20 }, { x: 15, y: 25 }])

    target.emit('pointerup', { x: 15, y: 25 })
    expect(ended).toBe(1)
    expect(target.count('pointermove')).toBe(0)
    expect(target.count('pointerup')).toBe(0)
  })

  it('coalesces moves to one per frame and flushes the last on pointerup', () => {
    const target = fakeTarget()
    const frames: Array<() => void> = []
    const moves: PointerPosition[] = []
    startPointerDrag({
      target,
      coalesce: true,
      schedule: cb => { frames.push(cb); return frames.length },
      cancel: () => {},
      onMove: p => moves.push(p),
    })

    target.emit('pointermove', { x: 1, y: 0 })
    target.emit('pointermove', { x: 2, y: 0 })
    target.emit('pointermove', { x: 3, y: 0 })
    // 还没到帧：一次都没派发。
    expect(moves).toEqual([])

    frames[0]?.()
    // 一帧只发最后一个位置。
    expect(moves).toEqual([{ x: 3, y: 0 }])

    target.emit('pointermove', { x: 7, y: 0 })
    target.emit('pointerup', { x: 7, y: 0 })
    // 抬起把最后一帧补发出去。
    expect(moves).toEqual([{ x: 3, y: 0 }, { x: 7, y: 0 }])
  })

  it('stop() detaches listeners without firing onEnd', () => {
    const target = fakeTarget()
    let ended = 0
    const drag = startPointerDrag({ target, onMove: () => {}, onEnd: () => { ended += 1 } })

    drag.stop()
    expect(target.count('pointermove')).toBe(0)
    expect(ended).toBe(0)

    // 收回后再派发不应有任何回调。
    target.emit('pointerup', { x: 0, y: 0 })
    expect(ended).toBe(0)
  })
})
