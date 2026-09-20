import { useTranslation } from 'react-i18next'
import { DOWNLOAD_VERSION, RELEASE_URL, REPO_URL } from '../downloads'
import { RequestTrace } from './request-trace'
import { Reveal } from './reveal'

/**
 * 首屏。
 *
 * 左文右图两栏：左边是「一句话承诺 + 两个动作」，右边是那条故障转移轨迹。
 * 旧版是居中的 logo + 大标题 + 按钮，页面上没有任何东西证明产品真的在做事；
 * 现在把最贵的横向空间让给一段可读的轨迹，标题压缩到两行以内。
 *
 * 小屏退化成一栏：先文字后轨迹（轨迹本身也不宽，缩到一栏仍然读得通）。
 */
export function Hero() {
  const { t } = useTranslation()

  return (
    <section id="top" className="relative pt-16 pb-20 sm:pt-24 sm:pb-28">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,29rem)] lg:gap-14">
        <div>
          <Reveal>
            <a
              href={RELEASE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-full border border-line bg-surface-1/60 py-1 pr-3.5 pl-1.5 text-[12px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
            >
              <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[11px] text-ink-2">
                v{DOWNLOAD_VERSION}
              </span>
              {t('hero.badge', '本地运行 · 开源可查')}
              <span
                aria-hidden="true"
                className="text-ink-4 transition-transform group-hover:translate-x-0.5"
              >
                →
              </span>
            </a>
          </Reveal>

          <Reveal delay={60}>
            <h1 className="mt-6 text-balance text-[2.15rem] leading-[1.16] font-semibold tracking-[-0.02em] text-ink sm:text-[2.75rem] lg:text-[3rem]">
              {t('hero.titleLead', '把你手上所有的大模型渠道，')}
              {t('hero.titlePre', '合成')}
              <span className="brand-gradient">{t('hero.titleAccent', '一个本地地址')}</span>
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mt-6 max-w-xl text-pretty text-[15px] leading-relaxed text-ink-3 sm:text-base">
              {t(
                'hero.lead',
                '客户端只需要知道一个地址。协议识别、渠道挑选、失败改道、请求记录，全部在 127.0.0.1 上完成 —— 当前渠道挂了，自动换下一个，客户端只会看到成功的那一次。',
              )}
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={RELEASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-void transition-colors hover:bg-white"
              >
                {t('hero.download', '下载最新版本')}
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-y-0.5"
                >
                  ↓
                </span>
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-line px-5 text-sm font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-white/4 hover:text-ink"
              >
                {t('hero.source', '查看源码')}
              </a>
            </div>
          </Reveal>

          <Reveal delay={240}>
            <p className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-4">
              <span>{t('hero.metaOs', 'macOS · Windows · Linux')}</span>
              <span aria-hidden="true">·</span>
              <span>{t('hero.metaNoAccount', '无需账号')}</span>
              <span aria-hidden="true">·</span>
              <span>{t('hero.metaPolyform', 'PolyForm Noncommercial')}</span>
            </p>
          </Reveal>
        </div>

        <Reveal delay={140}>
          <RequestTrace />
        </Reveal>
      </div>
    </section>
  )
}
