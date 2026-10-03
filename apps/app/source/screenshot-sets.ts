/**
 * 截图「编排」：把「拍哪些页、拍成什么语言与主题、落到哪里」从引擎里抽出来。
 *
 * 引擎（`screenshot-export.ts`）只回答「怎么抓一张图」——开一个受控窗口、等它真的画
 * 出来、调 `screencapture`、归一化尺寸。它**不该**知道我们有几个用途、每个用途要哪
 * 几页。之前那份 6 页 × 2 语言 × 2 主题的清单直接写死在引擎里，于是每多一个用途
 * （官网、README、文档……）就得改引擎，几个用途的取景还会被同一份清单绑死。
 *
 * 这一层把「用途」显式化：一份 **set** = 一组页面（shots）+ 要出的语言/主题 + 落盘
 * 目录。用途之间各自成一份，改一份不会牵动另一份；引擎只认「给我一组 case」。
 *
 * 工程上的取舍：这个文件**不写死绝对路径，也不推断仓库根**——仓库根由调用方（脚本 /
 * 无头入口）算好，传进来的 `outputDirectory` 才是权威。因为同一份定义既要在 Electron
 * 里跑（`app.getAppPath()`），又要在纯 Node 脚本里跑（`import.meta.url`），两者对
 * 「仓库在哪」的答案不一样；把推断塞进来，必然有一边算错。
 */

/** 出图的语言目录名（与 `snapshot/<locale>/...` 对齐）。 */
export type ScreenshotLocale = 'en' | 'zh-CN'
/** 出图的主题目录名。 */
export type ScreenshotTheme = 'light' | 'dark'

/**
 * 局部取景：只拍页面上某一个元素（外加一圈留白），而不是整窗。
 *
 * 文档里解释一个**局部**功能（某张设置卡、某个筛选栏、某行模型）时，整窗截图会把
 * 无关内容一起塞进正文，读者还得自己找重点。给一个 `selector` 就能只框住那块，
 * 效果是「正文讲到哪、图就指到哪」。
 */
export interface ScreenshotClip {
  /**
   * CSS 选择器，指向要截取的元素。优先用产品里刻意留的稳定锚点
   * （`data-screenshot="..."`，见 `packages/console` 的卡片），别依赖会随样式调整
   * 而变的结构选择器（`.space-y-3 > div:nth-child(2)` 这类）。
   */
  selector: string
  /** 命中多个元素时取第几个（从 0 起），默认第一个。 */
  index?: number
  /** 元素四周额外保留的像素（按 CSS 像素计，会被 DPR 放大），默认 0。 */
  padding?: number
  /** 元素较高时只取顶部这么多 CSS 像素（例如整页设置只截某段）。 */
  maxHeight?: number
}

/** 一张截图在控制台里的落点。`route` 是 `#` 后的那段（含查询串）。 */
export interface ScreenshotShot {
  /** 文件名（不含扩展名）。同一 set 内唯一，也是 `--only` 过滤与 `--with=<name>` 追加的键。 */
  fileName: string
  /** 控制台路由，如 `/overview?range=7d`；会拼进 `#<route>?lang=&theme=`。 */
  route: string
  /**
   * 拍这张之前要写进本地存储的状态。用于那些「默认进不去」的页面（例如引导页），
   * 键是 `localStorage` 的键名，值会被 `JSON.stringify` 后写入。
   */
  storage?: Record<string, unknown>
  /** 只拍页面上某个元素。不写就是整窗。 */
  clip?: ScreenshotClip
}

/** 关键字集扩展：`--with=<shot>` 引用任意 set 里的某张时，仍按它原来的存储状态拍。 */
export interface ScreenshotSet {
  /** set 名字，`--set=<name>` 用的就是它。 */
  name: string
  /** 一句话说明这份 set 服务于什么用途。 */
  description: string
  /** 默认要拍的语言；不写就是中英双语。 */
  locales?: readonly ScreenshotLocale[]
  /** 默认要拍的主题；不写就是明暗双主题。 */
  themes?: readonly ScreenshotTheme[]
  shots: readonly ScreenshotShot[]
}

const ALL_LOCALES: readonly ScreenshotLocale[] = ['en', 'zh-CN']
const ALL_THEMES: readonly ScreenshotTheme[] = ['light', 'dark']
/**
 * 官网 / README 用图：整站落地页与 README 共用的 6 张全景图。
 *
 * 图落仓库根的 `snapshot/`，由 `apps/www` 与两个 README 直接 import——重拍一次两边
 * 同时更新，不会再出现「官网挂着上一版界面」。语言与主题都要：官网会随访客的明暗与
 * 语言切换换图。
 */
const siteSet: ScreenshotSet = {
  name: 'site',
  description: 'Marketing / README hero shots (6 pages × locales × themes).',
  shots: [
    { fileName: '01-logical-models', route: '/logical-models' },
    { fileName: '02-smart-routing', route: '/router' },
    { fileName: '03-request-logs', route: '/request-logs' },
    { fileName: '04-analytics', route: '/overview?range=7d' },
    { fileName: '05-request-rewrite', route: '/request-rewrite-rules' },
    { fileName: '06-client-config', route: '/client-config' },
  ],
}

/**
 * 文档用图：带上下文、随正文裁剪的单页特写。
 *
 * 与 `site` 的差别不是「量的多少」，是**取景意图**：
 *   - 文档里的图是插在某一节正文之间的，读者顺着读下来，图只需要让他对上「这块界面
 *     长什么样」，不需要一张能当落地页 hero 的全景；
 *   - 所以文档只出**亮色一套**（文档站正文以亮色为主，暗色靠浏览器/站点主题切换），
 *     中英各一份跟随语言；
 *   - 文件名按**用途**取（`onboarding`、`routing-workflow`……），落到 `apps/docs/
 *     public/screenshots/<locale>/` 下，正文里用 markdown 图片语法引用（见 apps/docs/README.md）。
 *
 * 引导页需要预先写入 `osw-ui.onboardingComplete = false` 才能进去（默认落点是路由
 * 页），所以它单独带 `storage`；`screenshot-export` 在每张图之前会应用这段状态。
 *
 * 多数张是整窗取景；讲到某个**局部**功能时改用 `clip`（见 `ScreenshotClip`）——
 * 只框住那张卡片 / 那条工具栏，读者一眼就能把正文和图对上。
 */
const docsSet: ScreenshotSet = {
  name: 'docs',
  description: 'Handbook illustrations: per-page framing, light only, one per locale.',
  themes: ['light'],
  shots: [
    // 引导页：默认落点是路由页，得先把「走没走过引导」的标记压回去才进得去。
    {
      fileName: 'onboarding',
      route: '/onboarding',
      storage: { 'osw-ui': { state: { themeMode: 'light', onboardingComplete: false }, version: 0 } },
    },
    { fileName: 'logical-models', route: '/logical-models' },
    { fileName: 'routing-workflow', route: '/router' },
    { fileName: 'providers', route: '/model-management' },
    { fileName: 'request-logs', route: '/request-logs' },
    { fileName: 'analytics', route: '/overview?range=7d' },
    { fileName: 'request-rewrite', route: '/request-rewrite-rules' },
    { fileName: 'client-config', route: '/client-config' },

    // ── 局部取景（clip）──────────────────────────────────────────────
    // 下列各张只框住正文讲到的那一块：路由模式的切换、故障转移参数、缓存亲和、
    // 上游代理、日志保留、云同步、运行日志统计。锚点 `data-screenshot` 写在各卡片根元素上。
    { fileName: 'settings-route-mode', route: '/runtime-settings', clip: { selector: '[data-screenshot="route-mode"]', padding: 12 } },
    { fileName: 'settings-failover', route: '/runtime-settings', clip: { selector: '[data-screenshot="failover"]', padding: 12 } },
    { fileName: 'settings-cache-affinity', route: '/runtime-settings', clip: { selector: '[data-screenshot="cache-affinity"]', padding: 12 } },
    { fileName: 'settings-outbound-proxy', route: '/runtime-settings', clip: { selector: '[data-screenshot="outbound-proxy"]', padding: 12 } },
    { fileName: 'settings-log-retention', route: '/runtime-settings', clip: { selector: '[data-screenshot="log-retention"]', padding: 12 } },
    { fileName: 'settings-cloud-sync', route: '/runtime-settings', clip: { selector: '[data-screenshot="cloud-sync"]', padding: 12 } },
    // 设置页整页（只取顶部一段，避免上百件事挤成一根）。
    { fileName: 'settings-overview', route: '/runtime-settings', clip: { selector: '[data-screenshot="settings-content"]', padding: 16, maxHeight: 720 } },

    // 统计分析：指标概览与用量分布（两张局部，分别服务「看什么数」与「怎么看」）。
    { fileName: 'analytics-stats', route: '/overview?range=7d', clip: { selector: '[data-screenshot="overview-stats"]', padding: 16 } },
    { fileName: 'analytics-usage', route: '/overview?range=7d', clip: { selector: '[data-screenshot="overview-usage"]', padding: 16, maxHeight: 560 } },

    // 请求记录：筛选栏（一张局部，说明怎么缩范围）。
    { fileName: 'request-logs-filters', route: '/request-logs', clip: { selector: '[data-screenshot="request-logs-filters"]', padding: 12 } },

    // 运行日志：工具栏（实时开关、级别筛选、导出、清空）。
    { fileName: 'runtime-logs', route: '/logs', clip: { selector: '[data-screenshot="logs-toolbar"]', padding: 12 } },
  ],
}

/** 全部编排；`set` 名唯一。 */
export const SCREENSHOT_SETS: readonly ScreenshotSet[] = [siteSet, docsSet]

/** 默认 set：不传 `--set` 时拍它。保持「官网图」为默认，行为与改动前一致。 */
export const DEFAULT_SCREENSHOT_SET = siteSet.name

export function findScreenshotSet(name: string): ScreenshotSet | undefined {
  return SCREENSHOT_SETS.find(set => set.name === name)
}

/** set 里某张 shot；`--with` 用它解析。 */
export function findScreenshotShot(set: ScreenshotSet, fileName: string): ScreenshotShot | undefined {
  return set.shots.find(shot => shot.fileName === fileName)
}

/** 一份 set 里，按它的语言 × 主题 × 页面展开出的全部「要拍的 case」。 */
export interface ScreenshotCase {
  fileName: string
  route: string
  locale: ScreenshotLocale
  theme: ScreenshotTheme
  storage?: Record<string, unknown>
  clip?: ScreenshotClip
}

/**
 * 把一份 set 展开成具体的 case 列表。
 *
 * 展开顺序固定为 `locale → theme → shot`，与文件落盘结构
 * （`<locale>/<theme>/<fileName>.png`）一致，进度里的「第 N / 共 M 张」读起来就是
 * 目录的自然顺序。
 */
export function expandScreenshotSet(set: ScreenshotSet): ScreenshotCase[] {
  const locales = set.locales ?? ALL_LOCALES
  const themes = set.themes ?? ALL_THEMES
  return locales.flatMap(locale =>
    themes.flatMap(theme =>
      set.shots.map(shot => ({
        fileName: shot.fileName,
        route: shot.route,
        locale,
        theme,
        storage: shot.storage,
        clip: shot.clip,
      })),
    ),
  )
}

/**
 * 纯字符串直拼的地址：`baseUrl#<route>?lang=&theme=`。
 *
 * 用 `new URL()` 在这里会出问题：`baseUrl` 可能是 `http://[::1]:5173`，而真正的落点
 * 挂在 `#` 后的 hash 路由里；`URL` 会把 hash 原样保留，遇到含查询串的 route
 * （`/overview?range=7d`）就会拼出两层 `?`。这里手工拼反而只有一个规则。
 */
export function buildScreenshotUrl(baseUrl: string, captureCase: Pick<ScreenshotCase, 'route' | 'locale' | 'theme'>): string {
  const search = new URLSearchParams({ lang: captureCase.locale, theme: captureCase.theme }).toString()
  return `${baseUrl}#${captureCase.route}?${search}`
}
