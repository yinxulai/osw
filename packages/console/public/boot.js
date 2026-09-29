/*
 * 绘制前把主题与语言定下来，避免「先闪一下白底再变深色」「先闪英文再变中文」。
 *
 * 优先级必须和 `I18nProvider` / `useResolvedAppearance` 完全一致：
 *   主题：URL 里的 `?theme=` > 持久化偏好（`osw-ui`）> 系统
 *   语言：URL 里的 `?lang=` > 持久化偏好（`osw-language`）> 浏览器语言
 *
 * 两项都在查询串里，所以只解析一次 hash，不再区分路径段与查询参数。
 * 反正这里只要求「第一帧不闪」，挂载后 `I18nProvider` 会以服务端设置为准重算一遍。
 *
 * 为什么是 `public/` 下的独立脚本，而不是各页面里内联一段：主控制台与托盘面板是
 * 同一份产物里的两个 HTML 入口，两段内联脚本就是两份会各自漂移的「第一帧真相」。
 * 它必须是**非模块**脚本——`<script type="module">` 是延迟执行的，画完才跑。
 */
;(function () {
  var readPersisted = function (key) {
    try {
      var raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw).state : null
    } catch (error) {
      return null
    }
  }

  var hash = location.hash.replace(/^#/, '')
  var queryIndex = hash.indexOf('?')
  var query = queryIndex === -1 ? '' : hash.slice(queryIndex + 1)
  var params = new URLSearchParams(query)

  var ui = readPersisted('osw-ui') || {}
  var urlTheme = params.get('theme')
  // `system` 也是合法值（它表达「跟随系统」这个选择），所以这里当「已显式指定」处理，
  // 不再看偏好。
  var mode = urlTheme === 'light' || urlTheme === 'dark' || urlTheme === 'system'
    ? urlTheme
    : (ui.themeMode || 'system')
  var isDark = mode === 'dark'
    || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)

  // 认不出的语种当「没写」，退回偏好，而不是拦住整条地址。
  var urlLang = params.get('lang')
  var normalizedLang = urlLang && /^zh/i.test(urlLang)
    ? 'zh-CN'
    : (urlLang && /^en/i.test(urlLang) ? 'en' : null)
  var preference = (readPersisted('osw-language') || {}).preference
  var persistedLang = preference === 'zh-CN' || preference === 'en' ? preference : null
  var locale = normalizedLang || persistedLang || navigator.language || 'en'
  document.documentElement.lang = /^zh/i.test(locale) ? 'zh-CN' : 'en'
})()
