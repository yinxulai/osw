import { useTranslation } from 'react-i18next'
import { DOWNLOAD_VERSION, RELEASE_URL } from '../downloads'
import { PlatformIcon } from '../platform-icons'
import { PLATFORMS } from '../platforms'
import { Reveal } from './reveal'
import { SectionHeading } from './section-heading'

/**
 * 下载区。
 *
 * 全站唯一的「主行动区」，所以它是唯一居中的区块，也唯一带品牌色底纹——
 * 视觉上把它和上面所有「说明性」区块区分开，滚到这里就该知道要做什么。
 *
 * 一个按钮直达 GitHub Releases 的 `latest`，不再按平台给三个按钮：
 * 三个按钮里有三个是同一个链接，只会让人多点一次。
 */
export function DownloadSection() {
  const { t } = useTranslation()

  return (
    <section id="downloads" className="scroll-mt-24 py-16 sm:py-20">
      <Reveal>
        <div className="ring-gradient relative overflow-hidden rounded-3xl bg-surface-1/70 px-6 py-14 text-center sm:px-10">
          {/* 品牌色光晕：这是全站唯一一处大面积上色，用在主行动区。 */}
          <div
            aria-hidden="true"
            className="animate-drift pointer-events-none absolute -top-24 left-1/2 h-56 w-136 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(240_41_124/0.22),transparent)] blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-28 left-1/2 h-52 w-120 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(124_58_237/0.16),transparent)] blur-2xl"
          />

          <div className="relative">
            <SectionHeading
              align="center"
              eyebrow={t('downloads.eyebrow', '下载')}
              title={t('downloads.title', '装上就能用，不需要注册')}
              lead={t(
                'downloads.lead',
                '支持 macOS、Windows 与 Linux。在最新发布页按平台自取安装包，第一次启动后把客户端指向本地地址即可。',
              )}
            />

            <div className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
              {PLATFORMS.map((platform) => (
                <span
                  key={platform.id}
                  className="flex items-center gap-2 text-[13px] text-ink-3"
                >
                  <PlatformIcon id={platform.id} className="h-4.5 w-4.5 shrink-0" />
                  {platform.label}
                </span>
              ))}
            </div>

            <div className="mt-8 flex flex-col items-center">
              <a
                href={RELEASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex h-12 w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-void transition-colors hover:bg-white"
              >
                {t('downloads.action', '下载最新版本')}
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </a>

              <p className="mt-3.5 flex flex-wrap items-center justify-center gap-x-2 text-[12px] text-ink-4">
                <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px]">
                  v{DOWNLOAD_VERSION}
                </span>
                <span>{t('downloads.host', '在 GitHub Releases 上打开')}</span>
              </p>
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-center text-[12px] leading-relaxed text-ink-4">
          {t(
            'downloads.detail',
            'macOS 构建为 ad-hoc 签名且未公证——若首次启动被阻止，请在「系统设置 → 隐私与安全性」中允许。',
          )}
        </p>
      </Reveal>
    </section>
  )
}
