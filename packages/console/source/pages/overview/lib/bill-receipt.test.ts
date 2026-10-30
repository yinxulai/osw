import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillReceipt } from './bill-receipt'
import { receiptPullMax } from './receipt-metrics'

/** 控制器脱离 React 独立运行：这些用例一行渲染代码都没有。 */
describe('BillReceipt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('walks the print timeline processing → printing → complete', () => {
    const receipt = new BillReceipt()
    receipt.print()
    expect(receipt.getSnapshot().stage).toBe('processing')

    vi.advanceTimersByTime(1400)
    expect(receipt.getSnapshot().stage).toBe('printing')

    vi.advanceTimersByTime(1900)
    expect(receipt.getSnapshot().stage).toBe('complete')
  })

  it('notifies subscribers and hands back a fresh snapshot only when state changes', () => {
    const receipt = new BillReceipt()
    const before = receipt.getSnapshot()
    let notifications = 0
    receipt.subscribe(() => { notifications += 1 })

    receipt.endDrag() // 没有拖拽在进行，dragging 本就是 false：不应产生通知
    expect(notifications).toBe(0)
    expect(receipt.getSnapshot()).toBe(before)

    receipt.print()
    expect(notifications).toBeGreaterThan(0)
    expect(receipt.getSnapshot()).not.toBe(before)
  })

  it('refuses dragging until the receipt has finished printing', () => {
    const receipt = new BillReceipt()
    expect(receipt.beginDrag(10)).toBe(false)

    receipt.print()
    vi.advanceTimersByTime(3300)
    expect(receipt.beginDrag(100)).toBe(true)
    receipt.moveDrag(140)
    expect(receipt.getSnapshot().offsetY).toBe(40)
    expect(receipt.getSnapshot().dragging).toBe(true)

    receipt.endDrag()
    expect(receipt.getSnapshot().dragging).toBe(false)
  })

  it('clamps an endless wheel pull and only acts once complete', () => {
    const receipt = new BillReceipt()
    expect(receipt.wheel(100)).toBe(false)

    receipt.print()
    vi.advanceTimersByTime(3300)
    expect(receipt.wheel(1_000_000)).toBe(true)
    expect(receipt.getSnapshot().offsetY).toBe(receiptPullMax)
  })

  it('resets the paper position without touching the printed stage', () => {
    const receipt = new BillReceipt()
    receipt.print()
    vi.advanceTimersByTime(3300)
    receipt.wheel(500)
    expect(receipt.getSnapshot().offsetY).toBeGreaterThan(0)

    receipt.reset()
    expect(receipt.getSnapshot().offsetY).toBe(0)
    expect(receipt.getSnapshot().touched).toBe(false)
    expect(receipt.getSnapshot().stage).toBe('complete')
  })

  it('loads the QR code through the injected encoder', async () => {
    const receipt = new BillReceipt({ encodeQr: async () => 'data:image/png;base64,QR' })
    await receipt.loadQr()
    expect(receipt.getSnapshot().qrDataUrl).toBe('data:image/png;base64,QR')
  })

  it('swallows a QR failure and leaves the field empty', async () => {
    const receipt = new BillReceipt({ encodeQr: async () => { throw new Error('offline') } })
    await receipt.loadQr()
    expect(receipt.getSnapshot().qrDataUrl).toBe('')
  })

  it('ignores a late QR resolution after dispose', async () => {
    const receipt = new BillReceipt({ encodeQr: async () => 'data:image/png;base64,QR' })
    const pending = receipt.loadQr()
    receipt.dispose()
    await pending
    expect(receipt.getSnapshot().qrDataUrl).toBe('')
  })
})
