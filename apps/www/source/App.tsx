import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { CapabilitiesSection } from './components/capabilities-section'
import { DownloadSection } from './components/download-section'
import { FailoverSection } from './components/failover-section'
import { Hero } from './components/hero'
import { PrivacySection } from './components/privacy-section'
import { ScreenshotsSection } from './components/screenshots-section'
import { SiteFooter } from './components/site-footer'
import { SiteHeader } from './components/site-header'
import type { Lang } from './i18n'

/**
 * 落地页。整页只负责「背景层 + 区块顺序」，每节的实现都在 `components/` 下。
 *
 * 顺序即叙事：**是什么（首屏）→ 长什么样（界面预览）→ 还能调什么（能力）
 * → 挂了怎么办（故障转移）→ 数据去哪（隐私）→ 怎么拿到（下载）**。旧版把六张功能卡
 * 平铺在一起，读者要先自己判断「哪条更重要」，这一版改成逐节回答一个具体问题。
 *
 * 界面预览紧跟在首屏之后：读者还不知道细节、也还没被说服的时候，先让他看一眼界面
 * 长什么样，比先讲一遍故障转移判定口径更有效。
 */
export function App() {
  const { i18n } = useTranslation()
  const lang = i18n.language as Lang

  // 让 `<html lang>` 跟随界面语言（无障碍与搜索引擎用）。
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-void text-ink">
      {/* 背景层：顶部网格 + 两层品牌色光晕，只出现在页面上缘，不随内容重复。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-184"
      >
        <div className="bg-grid absolute inset-0" />
        <div className="animate-drift absolute inset-x-0 top-0 h-120 bg-[radial-gradient(52%_100%_at_50%_-8%,rgb(124_58_237/0.20),transparent_70%)]" />
        <div className="absolute inset-x-0 top-0 h-88 bg-[radial-gradient(38%_100%_at_68%_0%,rgb(240_41_124/0.13),transparent_72%)]" />
      </div>

      <SiteHeader />

      <main className="relative mx-auto max-w-6xl px-6">
        <Hero />
        <ScreenshotsSection />
        <CapabilitiesSection />
        <FailoverSection />
        <PrivacySection />
        <DownloadSection />
      </main>

      <SiteFooter />
    </div>
  )
}
