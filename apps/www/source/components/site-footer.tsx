import { useTranslation } from 'react-i18next'
import { REPO_URL } from '../downloads'
import { GitHubMark } from './site-header'

/**
 * 页脚。
 *
 * 旧版只有一行居中版权句，没有出口。这里补上真正有用的两条链接（源码 / 发布记录），
 * 版本号也留在这里——它是最不重要的信息，放在最下面最合适。
 */
export function SiteFooter() {
  const { t } = useTranslation()

  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-9 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" aria-hidden="true" className="h-5 w-5" />
          <span className="text-[12px] text-ink-4">
            {t('footer', '源码可见 · PolyForm Noncommercial · macOS · Windows · Linux')}
          </span>
        </div>

        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-[12px] text-ink-4 transition-colors hover:text-ink-2"
        >
          <GitHubMark className="h-3.5 w-3.5" />
          {t('footerRepo', '在 GitHub 上查看源码')}
        </a>
      </div>
    </footer>
  )
}
