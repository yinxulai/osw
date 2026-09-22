import { useTranslation } from 'react-i18next'
import type { Lang } from '../i18n'
import { LEADING_SHOT_ID, screenshotsFor, type Screenshot } from '../screenshots'
import { Reveal } from './reveal'
import { SectionHeading } from './section-heading'

/**
 * 界面预览。
 *
 * 全站唯一一处「证明它长什么样」的地方：前面几节都在讲产品做什么，
 * 这一节直接给图 —— 用户在下载之前就该知道界面是什么密度、什么色调。
 *
 * 版式是「一横四纵」：第一张通栏，先给一屏完整的；其余四张两列铺开，
 * 滚动时能一次比较两屏。图本身已经是深色的，套一层 `ring-gradient`
 * 就够和页面底色分开了 —— 不再垫灰底（那是用户最烦的「白底上再放白块」）。
 */
export function ScreenshotsSection() {
  const { t, i18n } = useTranslation()
  const shots = screenshotsFor(i18n.language as Lang)
  const leading = shots.find((shot) => shot.id === LEADING_SHOT_ID) ?? shots[0]
  const rest = shots.filter((shot) => shot !== leading)

  return (
    <section id="screenshots" className="scroll-mt-24 py-16 sm:py-20">
      <SectionHeading
        eyebrow={t('screenshots.eyebrow', '界面')}
        title={t('screenshots.title', '它长这样')}
        lead={t(
          'screenshots.lead',
          '五个主要页面，都是应用里的真实截图 —— 不是重画的示意图。',
        )}
      />

      <Reveal delay={80}>
        <Shot shot={leading} lead />
      </Reveal>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {rest.map((shot, index) => (
          <Reveal key={shot.id} delay={index * 70} className="h-full">
            <Shot shot={shot} />
          </Reveal>
        ))}
      </div>
    </section>
  )
}

interface ShotProps {
  shot: Screenshot
  /** 通栏那张：说明文字放宽一档，字号仍守 11px 下限以上。 */
  lead?: boolean
}

function Shot(params: ShotProps) {
  const { shot, lead = false } = params
  const { t } = useTranslation()

  return (
    <figure className="h-full">
      <div className="ring-gradient overflow-hidden rounded-xl bg-surface-0">
        <img
          src={shot.src}
          alt={t(`screenshots.${shot.id}.title`, shot.title)}
          loading="lazy"
          decoding="async"
          className="block w-full"
        />
      </div>
      <figcaption className={lead ? 'mt-3.5' : 'mt-3'}>
        <span className="text-[13px] font-medium text-ink-2">
          {t(`screenshots.${shot.id}.title`, shot.title)}
        </span>
        <span
          className={`mt-1 block text-pretty text-ink-3 ${lead ? 'text-[13px] leading-relaxed' : 'text-[12.5px] leading-relaxed'
            }`}
        >
          {t(`screenshots.${shot.id}.caption`, shot.caption)}
        </span>
      </figcaption>
    </figure>
  )
}
