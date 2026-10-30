import { toPng } from 'html-to-image'
import QRCode from 'qrcode'
import { clampReceiptOffset } from './receipt-metrics'

/**
 * 「小票打印机」交互的**领域层**——一个普通类，零 React。
 *
 * 出票时序、拖拽 / 滚轮位移、二维码、导出 PNG 全在这里；它用 `subscribe` / `getSnapshot`
 * 对外暴露可观察状态（与 `routing/history` 同一套约定），渲染层只用一个
 * `useSyncExternalStore` 薄绑定把它接进去（见 `../hooks/use-bill-receipt`）。
 *
 * 之所以是普通类而不是一串 `useState` / `useEffect`：这套状态机不该长在渲染周期上——
 * 它能脱离 React 单测（见 `bill-receipt.test.ts`），也能原样搬到托盘或别的宿主；
 * 换成自定义 hook 只是把同一批 hook 挪了个文件，依旧出不了渲染环境。
 */

export type ReceiptStage = 'processing' | 'printing' | 'complete'

export interface BillReceiptState {
  readonly stage: ReceiptStage
  /** 纸条位移（px）：负 = 塞回机器，正 = 往下拉出空白。 */
  readonly offsetY: number
  /** 用户是否碰过纸条（决定「下拉提示」显不显）。 */
  readonly touched: boolean
  readonly dragging: boolean
  readonly downloading: boolean
  readonly qrDataUrl: string
  readonly printedAt: Date
}

/** 账单二维码指向的落地页。 */
const RECEIPT_QR_TARGET = 'https://osw.yinxulai.com/'
/** 出票时序：入队 →（1.4s）印刷 →（3.3s）完成。两段耗时对齐动画节奏。 */
const PRINTING_DELAY_MS = 1400
const COMPLETE_DELAY_MS = 3300
/** 滚轮一个 tick 折算成多少位移。 */
const WHEEL_STEP = 0.22

type Listener = () => void
/** 可注入的二维码编码器；默认用 `qrcode`，单测替成同步假实现。 */
export type QrEncoder = (target: string) => Promise<string>

export interface BillReceiptOptions {
  encodeQr?: QrEncoder
}

function defaultEncodeQr(target: string): Promise<string> {
  return QRCode.toDataURL(target, {
    margin: 1,
    width: 132,
    color: { dark: '#20252f', light: '#fffefc' },
  })
}

export class BillReceipt {
  private state: BillReceiptState = {
    stage: 'processing',
    offsetY: 0,
    touched: false,
    dragging: false,
    downloading: false,
    qrDataUrl: '',
    printedAt: new Date(),
  }

  private readonly listeners = new Set<Listener>()
  private readonly encodeQr: QrEncoder
  private timers: ReturnType<typeof setTimeout>[] = []
  private drag = { active: false, startY: 0, startOffset: 0 }
  private disposed = false

  constructor(options: BillReceiptOptions = {}) {
    this.encodeQr = options.encodeQr ?? defaultEncodeQr
  }

  /** 订阅状态变化。返回退订函数。 */
  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 当前快照。引用只在状态真的变化时更换，`useSyncExternalStore` 据此判断要不要重渲染。 */
  readonly getSnapshot = (): BillReceiptState => this.state

  private set(patch: Partial<BillReceiptState>): void {
    const changed = (Object.keys(patch) as Array<keyof BillReceiptState>).some(key => this.state[key] !== patch[key])
    if (!changed) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** 清掉还没触发的出票定时器。 */
  readonly clearTimers = (): void => {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  /** 重新出一张票：归位、回到 processing，再排两段时序把 stage 推到 printing / complete。 */
  readonly print = (): void => {
    this.clearTimers()
    this.drag.active = false
    this.set({ printedAt: new Date(), offsetY: 0, touched: false, dragging: false, stage: 'processing' })
    this.timers = [
      setTimeout(() => this.set({ stage: 'printing' }), PRINTING_DELAY_MS),
      setTimeout(() => this.set({ stage: 'complete' }), COMPLETE_DELAY_MS),
    ]
  }

  /** 把纸条归位，免得下次打开还带着上次拉出来的那一大截空白。 */
  readonly reset = (): void => {
    this.drag.active = false
    this.set({ offsetY: 0, touched: false, dragging: false })
  }

  /** 开始拖拽。只有出票完成后才可拖；返回是否真的开始（供调用方决定要不要抓指针）。 */
  readonly beginDrag = (clientY: number): boolean => {
    if (this.state.stage !== 'complete') return false
    this.drag = { active: true, startY: clientY, startOffset: this.state.offsetY }
    this.set({ touched: true, dragging: true })
    return true
  }

  readonly moveDrag = (clientY: number): void => {
    if (!this.drag.active || this.state.stage !== 'complete') return
    const delta = clientY - this.drag.startY
    this.set({ offsetY: clampReceiptOffset(this.drag.startOffset + delta) })
  }

  readonly endDrag = (): void => {
    this.drag.active = false
    this.set({ dragging: false })
  }

  /** 滚轮推拉纸条。返回是否受理（未完成时不受理，调用方据此决定要不要拦默认滚动）。 */
  readonly wheel = (deltaY: number): boolean => {
    if (this.state.stage !== 'complete') return false
    this.set({ touched: true, offsetY: clampReceiptOffset(this.state.offsetY + deltaY * WHEEL_STEP) })
    return true
  }

  /** 生成账单二维码。失败就留空，不挡出票。 */
  readonly loadQr = async (): Promise<void> => {
    try {
      const url = await this.encodeQr(RECEIPT_QR_TARGET)
      if (!this.disposed) this.set({ qrDataUrl: url })
    } catch {
      if (!this.disposed) this.set({ qrDataUrl: '' })
    }
  }

  /**
   * 把离屏场景节点导出成 PNG 下载。
   *
   * 不传 `backgroundColor`：导出图保留 alpha，半透明底板才能露出使用方的底色。
   * 渲染的是**完整的离屏场景**，不是对话框里那个被视口裁过的预览。
   */
  readonly download = async (node: HTMLElement | null, range: string): Promise<void> => {
    if (!node || this.state.downloading) return
    this.set({ downloading: true })
    try {
      const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 2.5, skipFonts: false })
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `osw-bill-${range}-${Date.now()}.png`
      link.click()
    } finally {
      this.set({ downloading: false })
    }
  }

  /** 卸载时收尾：停掉定时器，并忽略之后迟到的二维码回调。 */
  readonly dispose = (): void => {
    this.disposed = true
    this.clearTimers()
  }
}
