import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
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
 * 版式是「一张大图 + 一份目录」，不是五张平铺。理由是高度：五张 1139×696
 * 的图铺进两列，一屏能滚出三屏，而读者滚完之后其实哪一张都没看清。这里一次
 * 只放大一张（宽度让给目录之后约 500px 高，整节从 1500px 降到 700px 上下），
 * 右边用五个页面名把全部内容列出来 —— 「产品一共有几个页面」一眼仍然看得见。
 *
 * 图本身已经是深色的，套一层 `ring-gradient` 就够和页面底色分开了；
 * 不垫灰底，也不给目录条目加底框 —— 一根品牌色游标加序号，已经足够说明
 * 这一列是可点的，再包一层灰盒子就是「白底上又放白块」。
 */
export function ScreenshotsSection() {
  const { t, i18n } = useTranslation()
  const shots = screenshotsFor(i18n.language as Lang)
  const [activeId, setActiveId] = useState(LEADING_SHOT_ID)
  const active = shots.find((shot) => shot.id === activeId) ?? shots[0]
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  const labelOf = (shot: Screenshot) => t(`screenshots.${shot.id}.title`, shot.title)

  /**
   * 标准 tablist 键盘行为：方向键在条目间移动，并把焦点一起带走；Home / End 跳首尾。
   * 窄屏目录是横排（左右键），宽屏变竖排（上下键），所以两组方向都接。
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    const current = shots.findIndex((shot) => shot.id === active.id)

    let next = current
    if (step !== 0) next = (current + step + shots.length) % shots.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = shots.length - 1
    else return

    event.preventDefault()
    setActiveId(shots[next].id)
    tabs.current[next]?.focus()
  }

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

      <Reveal delay={80} className="mt-8 sm:mt-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
          <div
            id="shot-panel"
            role="tabpanel"
            aria-labelledby={`shot-tab-${active.id}`}
            className="ring-gradient overflow-hidden rounded-xl bg-surface-0"
          >
            <img
              src={active.src}
              alt={labelOf(active)}
              decoding="async"
              className="block aspect-[1139/696] w-full object-cover object-top"
            />
          </div>

          {/* 目录在 lg 断点从横排变竖排；说明文字钉在这一列底部，和图片下沿对齐。 */}
          <div className="flex flex-col gap-6 lg:justify-between">
            <div
              role="tablist"
              aria-label={t('screenshots.gallery', '界面截图')}
              onKeyDown={onKeyDown}
              className="flex flex-wrap gap-x-5 gap-y-1.5 lg:flex-col lg:gap-x-0 lg:gap-y-0.5"
            >
              {shots.map((shot, index) => {
                const selected = shot.id === active.id
                return (
                  <button
                    key={shot.id}
                    ref={(node) => {
                      tabs.current[index] = node
                    }}
                    type="button"
                    role="tab"
                    id={`shot-tab-${shot.id}`}
                    aria-controls="shot-panel"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveId(shot.id)}
                    className={`flex shrink-0 cursor-pointer items-center gap-2.5 border-b-2 border-transparent p-0 pb-1.5 text-left text-[13px] font-medium transition-colors lg:w-full lg:border-b-0 lg:border-l-2 lg:py-2 lg:pl-3 ${
                      selected ? 'border-brand text-ink' : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="hidden text-[11px] tabular-nums text-ink-4 lg:inline"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {labelOf(shot)}
                  </button>
                )
              })}
            </div>

            <div className="border-t border-line pt-4">
              <p className="text-pretty text-[13px] leading-relaxed text-ink-3">
                {t(`screenshots.${active.id}.caption`, active.caption)}
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
