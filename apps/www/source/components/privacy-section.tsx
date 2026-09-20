import { useTranslation } from 'react-i18next'
import { Reveal } from './reveal'
import { SectionHeading } from './section-heading'

/**
 * 隐私区块。
 *
 * 放在能力清单之后、下载之前：它是「要不要装」的决定性理由之一，
 * 但比功能细节更情绪化，所以用三条并列的短句，不铺开成长文。
 * 三条的写法统一为「不是 X，是 Y」——否定的部分正是用户默认会怀疑的部分。
 */
interface Claim {
  id: string
  title: string
  body: string
}

const CLAIMS: Claim[] = [
  {
    id: 'listener',
    title: '监听地址只有本机',
    body: '网关绑定 127.0.0.1，不监听局域网网卡。同一网络下的其他设备连不上它。',
  },
  {
    id: 'keys',
    title: '密钥交给系统保管',
    body: '渠道密钥存进 macOS Keychain / Windows 凭据管理器 / Linux Secret Service，不进配置文件，也不写日志。',
  },
  {
    id: 'upstream',
    title: '只连你配置的上游',
    body: '没有账号体系、没有云同步、没有中转服务器。除了你自己填的渠道地址，它不向任何地方发数据。',
  },
]

export function PrivacySection() {
  const { t } = useTranslation()

  return (
    <section id="privacy" className="scroll-mt-24 py-16 sm:py-20">
      <SectionHeading
        eyebrow={t('privacy.eyebrow', '隐私')}
        title={t('privacy.title', '密钥和请求内容不出这台机器')}
        lead={t(
          'privacy.lead',
          '把公司密钥交给一个不认识的中转服务，是这个产品想解决的问题。所以这里的默认值全部按「不信任网络」来设。',
        )}
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {CLAIMS.map((claim, index) => (
          <Reveal key={claim.id} delay={index * 70}>
            <article className="ring-gradient h-full rounded-2xl bg-surface-0/60 p-6">
              <span
                aria-hidden="true"
                className="block h-px w-8 bg-linear-to-r from-brand to-transparent"
              />
              <h3 className="mt-5 text-[15px] font-semibold tracking-tight text-ink">
                {t(`privacy.${claim.id}.title`, claim.title)}
              </h3>
              <p className="mt-2.5 text-pretty text-[13px] leading-relaxed text-ink-3">
                {t(`privacy.${claim.id}.body`, claim.body)}
              </p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
