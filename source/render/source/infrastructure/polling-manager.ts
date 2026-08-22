export type PollingFetcher = (silent: boolean) => Promise<void>

type Entry = {
  intervalMs: number
  refs: number
  timer: ReturnType<typeof setInterval> | null
  fetcher: PollingFetcher
  loaded: boolean
  inflight: boolean
}

/** 引用计数轮询：同一 key 只有一个 timer 和一个并发请求。 */
class PollingManager {
  private readonly entries = new Map<string, Entry>()

  subscribe(key: string, intervalMs: number, fetcher: PollingFetcher): () => void {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { intervalMs, refs: 0, timer: null, fetcher, loaded: false, inflight: false }
      this.entries.set(key, entry)
    }
    if (entry.refs === 0) {
      void this.fetch(key, entry.loaded)
      entry.timer = setInterval(() => void this.fetch(key, true), entry.intervalMs)
    }
    entry.refs++
    return () => {
      const current = this.entries.get(key)
      if (!current) return
      current.refs--
      if (current.refs <= 0 && current.timer) {
        clearInterval(current.timer)
        current.timer = null
      }
    }
  }

  refresh(key: string): void {
    void this.fetch(key, true)
  }

  private async fetch(key: string, silent: boolean): Promise<void> {
    const entry = this.entries.get(key)
    if (!entry || entry.inflight) return
    entry.inflight = true
    try {
      await entry.fetcher(silent || entry.loaded)
      entry.loaded = true
    } finally {
      entry.inflight = false
    }
  }
}

export const pollingManager = new PollingManager()
