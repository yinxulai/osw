import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

/** 站点支持的语言。 */
export type Lang = 'en' | 'zh'

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
]

/**
 * 兜底语言固定为中文：**中文不建资源表**，而是直接写在 `t(key, '中文文案')` 的
 * 兜底参数里（就写在用到它的那个组件里）。所以英文缺 key 时会自动回落到代码内联
 * 的中文，不会出现「页面漏一句翻译」的情况。
 */
export const FALLBACK_LANG: Lang = 'zh'

/**
 * 英文译文表，key 与各组件的 `t()` 第一个参数一一对应。
 * 新增文案时：先在组件里写中文兜底，再决定要不要在这里补英文。
 */
const en = {
  nav: {
    failover: 'Failover',
    capabilities: 'Capabilities',
    screenshots: 'Interface',
    privacy: 'Privacy',
    downloads: 'Download',
    download: 'Download',
  },
  hero: {
    badge: 'Runs locally · source-available',
    titleLead: 'Turn every model channel you already pay for',
    titlePre: ' into ',
    titleAccent: 'one local address',
    lead: 'Your clients only ever need to know a single address. Protocol detection, channel selection, failover and request logging all happen on 127.0.0.1 — when a channel dies the request moves on, and the client only ever sees the attempt that succeeded.',
    download: 'Download the latest release',
    source: 'View source',
    metaOs: 'macOS · Windows · Linux',
    metaNoAccount: 'No account needed',
    metaPolyform: 'PolyForm Noncommercial',
  },
  trace: {
    title: 'A real request, start to finish',
    hop1: 'Client → local gateway',
    hop1Badge: 'detected',
    hop2: 'Channel A · Volcengine',
    hop2Detail: '429 · rate limited',
    hop2Badge: 'rerouting',
    hop3: 'Channel B · OpenAI',
    hop3Detail: '200 · 653ms · 0.14s to first token',
    hop3Badge: 'completed',
    footnote: 'The client only sees the attempt that succeeded',
    attempts: '2 attempts · 0 spliced',
  },
  failover: {
    eyebrow: 'Failover',
    title: 'Channels go down. That is the normal case.',
    lead: 'Network flakiness, rate limits, exhausted quota, rejected keys, upstream 5xx — none of that is your problem to handle. Below is the complete rule set, with no hidden "you may need to switch manually" exceptions.',
    colTrigger: 'What the upstream did',
    colVerdict: 'What OSW does',
    colNote: 'Notes',
    verdict: {
      switch: 'next channel',
      pass: 'pass through',
      abort: 'abort',
    },
    rule: {
      network: {
        trigger: 'Network error / connect timeout / stream idle timeout',
        note: 'Move to the next channel',
      },
      auth: {
        trigger: '401 / 403',
        note: 'Move to the next channel and accumulate a failure state for that provider',
      },
      pressure: { trigger: '408 / 429', note: 'Move to the next channel' },
      server: { trigger: '5xx', note: 'Move to the next channel' },
      client: {
        trigger: 'Any other 4xx (a malformed parameter, for example)',
        note: 'Return it to you as-is — another channel would fail the same way',
      },
      stream: {
        trigger: 'Connection dropped after the response started streaming',
        note: 'Abort the request; never splice in output from another channel',
      },
    },
    tuning:
      'By default three consecutive failures trigger a cooldown, the first cooldown is 30 seconds (growing with each failure up to 5 minutes), and a stream with no new data for 30 seconds counts as timed out — all three numbers are adjustable under Settings → Reliability → Failover.',
  },
  capabilities: {
    eyebrow: 'Capabilities',
    title: 'A configurable middleware layer on top of the gateway',
    lead: 'Pass-through is the default, but real projects always need a nudge somewhere: one client should use a different channel, one upstream names its fields differently, one request is slow enough that you need to know why.',
    routing: {
      title: 'Routing & rewrite',
      body: 'After a request enters the gateway and before it leaves for an upstream, you decide where it goes and what it looks like.',
      p1: 'Draw the split in a node graph — combine model, client and header conditions freely',
      p2: 'A rule table for people who prefer writing config; switch between the two at any time',
      p3: 'Every save of the routing graph becomes a version you can roll back in one click',
      p4: 'Rewrite rules change headers, edit JSON fields or replace text without writing code',
    },
    observability: {
      title: 'Every attempt is recorded',
      body: 'Which channel actually served the request is usually a guess everywhere else.',
      p1: 'The provider and model that really answered',
      p2: 'Which attempt succeeded',
      p3: 'Total time, first-token latency, tokens per second',
    },
    protocol: {
      title: 'Automatic protocol detection',
      body: 'One port accepts Responses, Completions and Messages at the same time, deciding from the request body — no client-side config to change.',
      p1: 'OpenAI Responses API',
      p2: 'OpenAI Chat Completions',
      p3: 'Anthropic Messages',
    },
    more: 'The failover rules are in the section above; where your data goes is in the Privacy section below.',
  },
  screenshots: {
    eyebrow: 'Interface',
    title: 'What it actually looks like',
    lead: 'Five of the main pages, all real screenshots from the app — nothing redrawn or mocked up.',
    logicalModels: {
      title: 'Logical models',
      caption:
        'Drag to set the order they are tried in. Every model carries its own recent record — TPS, first-token latency, consecutive failures.',
    },
    smartRouting: {
      title: 'Smart Routing',
      caption:
        'Switch between a node graph and a plain rule table at any time; every save is a version you can roll back.',
    },
    requestLogs: {
      title: 'Request logs',
      caption:
        'One row per request, expandable into the full execution detail: every attempt, the channel that really answered, usage and response rewrites.',
    },
    requestRewrite: {
      title: 'Request rewrite',
      caption:
        'Headers, JSON fields and text replacement without writing any code; New rule ships with templates.',
    },
    analytics: {
      title: 'Analytics',
      caption:
        'Success rate, latency, first-token latency, tokens per second, cache hits, model ranking and failure reasons.',
    },
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'Your keys and request bodies reach nobody else',
    lead: 'Handing company keys to a relay service you know nothing about is the problem this product exists to solve, so every default here assumes the network is untrusted. The one exception worth spelling out is right below.',
    listener: {
      title: 'Binds to this machine by default',
      body: 'The gateway binds 127.0.0.1 by default and never listens on a LAN interface, so other devices on the same network cannot reach it — unless you explicitly rebind it to 0.0.0.0 in the runtime settings, for example to reach it from WSL.',
    },
    keys: {
      title: 'Keys live in the OS keychain',
      body: 'Channel keys are stored in macOS Keychain / Windows Credential Manager / Linux Secret Service — not in a config file, and not in logs.',
    },
    upstream: {
      title: 'Requests go only to upstreams you configured',
      body: 'No account system, no cloud sync, no relay server: requests go only to the channel URLs you typed in yourself. The one piece of traffic that leaves on its own is the anonymous statistics in the next card.',
    },
    telemetry: {
      title: 'Anonymous statistics, stated plainly',
      body: 'Enabled by default. It answers two questions only — how many people are using it, and which features are actually used. No request content, no device fingerprinting, no user profiles; the payload goes to api.osw.yinxulai.com.',
    },
  },
  downloads: {
    eyebrow: 'Download',
    title: 'Install it and go — no sign-up',
    lead: 'Available for macOS, Windows and Linux. Grab your installer from the latest release, then point your clients at the local address.',
    action: 'Download the latest release',
    host: 'Opens GitHub Releases',
    detail:
      'macOS builds are ad-hoc signed and not notarized — if the first launch is blocked, allow it under System Settings → Privacy & Security.',
  },
  footer: 'Source-available under PolyForm Noncommercial · macOS · Windows · Linux',
  footerRepo: 'View the source on GitHub',
}

/** 首次进入按浏览器语言选一个；识别不到就用兜底语言（中文）。 */
function detectLang(): Lang {
  const preferred = typeof navigator === 'undefined' ? '' : navigator.language
  return preferred.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: detectLang(),
  fallbackLng: FALLBACK_LANG,
  // 纯前端渲染且文案自带中文兜底，插值无需转义。
  interpolation: { escapeValue: false },
  // 资源内联、初始化同步完成，无需 Suspense 边界。
  react: { useSuspense: false },
})

export default i18n
