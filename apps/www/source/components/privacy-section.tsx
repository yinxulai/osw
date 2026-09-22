import { useTranslation } from 'react-i18next'
import { Reveal } from './reveal'
import { SectionHeading } from './section-heading'

/**
 * 隐私区块。
 *
 * 放在界面预览之后、下载之前：它是「要不要装」的决定性理由之一，
 * 但比功能细节更情绪化，所以用几条并列的短句，不铺开成长文。
 *
 * 边界写的是**默认行为**，不是绝对保证：监听地址可以由用户改绑（`listenHost`），
 * 2026-08-25 起连 Host 头校验都删了，所以「不监听局域网网卡」必须带上「默认」。
 *
 * 第四条「匿名统计」是这一节里唯一一条**对我们自己不利**的：统计默认开启、
 * 界面里没有开关，所以旧版那句「它不向任何地方发数据」是错的（英文版同一句也错）。
 * 说出口比藏着强 —— 其余三条都是「不做什么」，只有这条是「做了什么」。
 */
interface Claim {
  id: string
  title: string
  body: string
}

const CLAIMS: Claim[] = [
  {
    id: 'listener',
    title: '监听地址默认只有本机',
    body: '网关默认绑定 127.0.0.1，不监听局域网网卡，同一网络里的其他设备默认连不上它。要从 WSL 或局域网访问，需要你在运行设置里显式改绑 0.0.0.0。',
  },
  {
    id: 'keys',
    title: '密钥交给系统保管',
    body: '渠道密钥存进 macOS Keychain / Windows 凭据管理器 / Linux Secret Service，不进配置文件，也不写日志。',
  },
  {
    id: 'upstream',
    title: '请求只发往你配的上游',
    body: '没有账号体系、没有云同步、没有中转服务器，请求只发往你自己填的渠道地址。唯一一处会自己出站的流量，是旁边这张卡说的匿名统计。',
  },
  {
    id: 'telemetry',
    title: '匿名统计，如实说明',
    body: '它默认开启，只回答「有多少人在用、哪些功能真被用了」。不采集任何请求内容，不做设备指纹，不做用户画像；报文只发往 api.osw.yinxulai.com。',
  },
]

export function PrivacySection() {
  const { t } = useTranslation()

  return (
    <section id="privacy" className="scroll-mt-24 py-16 sm:py-20">
      <SectionHeading
        eyebrow={t('privacy.eyebrow', '隐私')}
        title={t('privacy.title', '密钥和请求内容不进任何人的服务器')}
        lead={t(
          'privacy.lead',
          '把公司密钥交给一个不认识的中转服务，是这个产品想解决的问题。所以这里的默认值全部按「不信任网络」来设 —— 唯一需要向你交代的例外，也写在下面。',
        )}
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {CLAIMS.map((claim, index) => (
          <Reveal key={claim.id} delay={index * 70} className="h-full">
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
