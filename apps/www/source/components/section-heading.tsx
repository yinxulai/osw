import type { ReactNode } from 'react'
import { Reveal } from './reveal'

interface SectionHeadingProps {
  /** 小标签，说明这一节回答什么问题。 */
  eyebrow: string
  title: ReactNode
  lead?: string
  /** 居中排版只给「收口型」的区块（下载），并列型区块一律左对齐。 */
  align?: 'start' | 'center'
}

/**
 * 区块标题组。整站的层级都走这里，保证每节的信息顺序一致：
 * 小标签（这是什么）→ 标题（结论）→ 引言（补充条件）。
 */
export function SectionHeading(params: SectionHeadingProps) {
  const { eyebrow, title, lead, align = 'start' } = params
  const centered = align === 'center'

  return (
    <Reveal className={centered ? 'text-center' : undefined}>
      <p className="text-[11px] font-medium tracking-[0.18em] text-ink-4 uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight text-ink sm:text-[2rem] sm:leading-[1.2]">
        {title}
      </h2>
      {lead ? (
        <p
          className={`mt-3.5 max-w-2xl text-pretty text-[15px] leading-relaxed text-ink-3 ${centered ? 'mx-auto' : ''
            }`}
        >
          {lead}
        </p>
      ) : null}
    </Reveal>
  )
}
