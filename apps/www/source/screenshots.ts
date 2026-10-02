import type { Lang } from './i18n'
import type { Theme } from './theme'
import analyticsEnDark from '../../../snapshot/en/dark/04-analytics.png'
import analyticsEnLight from '../../../snapshot/en/light/04-analytics.png'
import clientConfigEnDark from '../../../snapshot/en/dark/06-client-config.png'
import clientConfigEnLight from '../../../snapshot/en/light/06-client-config.png'
import logicalModelsEnDark from '../../../snapshot/en/dark/01-logical-models.png'
import logicalModelsEnLight from '../../../snapshot/en/light/01-logical-models.png'
import requestLogsEnDark from '../../../snapshot/en/dark/03-request-logs.png'
import requestLogsEnLight from '../../../snapshot/en/light/03-request-logs.png'
import requestRewriteEnDark from '../../../snapshot/en/dark/05-request-rewrite.png'
import requestRewriteEnLight from '../../../snapshot/en/light/05-request-rewrite.png'
import smartRoutingEnDark from '../../../snapshot/en/dark/02-smart-routing.png'
import smartRoutingEnLight from '../../../snapshot/en/light/02-smart-routing.png'
import analyticsZhDark from '../../../snapshot/zh-CN/dark/04-analytics.png'
import analyticsZhLight from '../../../snapshot/zh-CN/light/04-analytics.png'
import clientConfigZhDark from '../../../snapshot/zh-CN/dark/06-client-config.png'
import clientConfigZhLight from '../../../snapshot/zh-CN/light/06-client-config.png'
import logicalModelsZhDark from '../../../snapshot/zh-CN/dark/01-logical-models.png'
import logicalModelsZhLight from '../../../snapshot/zh-CN/light/01-logical-models.png'
import requestLogsZhDark from '../../../snapshot/zh-CN/dark/03-request-logs.png'
import requestLogsZhLight from '../../../snapshot/zh-CN/light/03-request-logs.png'
import requestRewriteZhDark from '../../../snapshot/zh-CN/dark/05-request-rewrite.png'
import requestRewriteZhLight from '../../../snapshot/zh-CN/light/05-request-rewrite.png'
import smartRoutingZhDark from '../../../snapshot/zh-CN/dark/02-smart-routing.png'
import smartRoutingZhLight from '../../../snapshot/zh-CN/light/02-smart-routing.png'

/**
 * 界面预览用的截图。
 *
 * 图**不复制进 `public/`**，而是从仓库根部的 `snapshot/` 直接 import：
 * `README.md` / `README.zh-CN.md` 用的是同一批文件，重拍一次两边同时更新，
 * 不会再出现「官网挂着上一版界面」这种漂移。Vite 会把它们哈希后放进
 * `output/assets/`，构建产物里也不会出现两份。
 *
 * 中文写在这里（`title` / `caption`）而不是写进 i18n 表，与 `failover-section`
 * 的 `RULES` 一致：`t(key, 中文)` 的兜底参数就是中文原文，英文放 `i18n.ts`。
 *
 * 已知的两处不干净，都是**产品数据**而不是截图本身的问题（重拍也还会在）：
 * - `smartRouting`：画布里的预置节点名仍是中文，因为
 *   `packages/contracts/source/router/presets.ts` 把名字写成了中文字面量；
 * - `requestRewrite`：规则名 `修改 User-Agent` 是用户自己起的名字。
 */
export interface Screenshot {
  /** i18n key 前缀（`screenshots.<id>.title` / `.caption`）兼 React key。 */
  id: string
  src: string
  /** 页面名。也用作图片的 alt —— 紧挨着的 `figcaption` 会补上完整说明。 */
  title: string
  /** 一句话讲「这张图想让你看到什么」，不复述界面上已经写着的字。 */
  caption: string
}

interface ShotSource {
  id: string
  light: Record<Lang, string>
  dark: Record<Lang, string>
  title: string
  caption: string
}

const SHOTS: ShotSource[] = [
  {
    id: 'logicalModels',
    light: { en: logicalModelsEnLight, zh: logicalModelsZhLight },
    dark: { en: logicalModelsEnDark, zh: logicalModelsZhDark },
    title: '逻辑模型',
    caption: '拖拽决定尝试顺序，每个模型都带着自己的近期战绩 —— TPS、首字延迟、连续失败次数。',
  },
  {
    id: 'smartRouting',
    light: { en: smartRoutingEnLight, zh: smartRoutingZhLight },
    dark: { en: smartRoutingEnDark, zh: smartRoutingZhDark },
    title: '智能路由',
    caption: '顶部在节点图与规则表之间切换，两者随时互切；每次保存都是一个能回滚的版本。',
  },
  {
    id: 'requestLogs',
    light: { en: requestLogsEnLight, zh: requestLogsZhLight },
    dark: { en: requestLogsEnDark, zh: requestLogsZhDark },
    title: '请求日志',
    caption: '一行一次请求，展开就是完整执行明细：每次尝试、真正命中的渠道、用量与响应改写。',
  },
  {
    id: 'requestRewrite',
    light: { en: requestRewriteEnLight, zh: requestRewriteZhLight },
    dark: { en: requestRewriteEnDark, zh: requestRewriteZhDark },
    title: '请求改写',
    caption: '改 Header、改 JSON 字段、替换文本，都不需要写代码；新建规则自带模板。',
  },
  {
    id: 'analytics',
    light: { en: analyticsEnLight, zh: analyticsZhLight },
    dark: { en: analyticsEnDark, zh: analyticsZhDark },
    title: '统计分析',
    caption: '成功率、延迟、首字延迟、每秒 token、缓存命中、模型排行与失败原因。',
  },
  {
    id: 'clientConfig',
    light: { en: clientConfigEnLight, zh: clientConfigZhLight },
    dark: { en: clientConfigEnDark, zh: clientConfigZhDark },
    title: '客户端配置',
    caption: '一次生成客户端要填的值与要改的文件，改前留版本、随时能回退；改哪些文件由注册表白名单说了算。',
  },
]

/** 进入页面时默认放大的那张（也是六个页面里最直接说明「这一步在解决什么」的一张）。 */
export const LEADING_SHOT_ID = SHOTS[0].id

export function screenshotsFor(lang: Lang, theme: Theme): Screenshot[] {
  return SHOTS.map((shot) => ({
    id: shot.id,
    src: shot[theme][lang],
    title: shot.title,
    caption: shot.caption,
  }))
}
