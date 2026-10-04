import { ExternalLink, Users } from 'lucide-react'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from '@/components/ui/avatar'
import { FormRow } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import { getPlatformCapabilities } from '@/platform/capabilities'
import {
  DISCORD_URL,
  REPOSITORY_CONTRIBUTORS_URL,
  REPOSITORY_URL,
} from '@/lib/external-links'
import { useContributors } from '../hooks/use-contributors'

/**
 * 开发者：源码仓库、社区入口，以及一张贡献者头像墙。
 *
 * 用 `getPlatformCapabilities().openExternal()` 打开外链，而不是渲染 `<a target="_blank">`：
 * Electron 窗口里点 `<a>` 会把页面导航到外部站点、把控制台顶掉，只有 `shell.openExternal`
 * 才是交给系统浏览器的正确路径。浏览器形态下这个能力退回 `window.open`（见 `platform/capabilities.ts`），
 * 所以整个组件在两种形态下都能用，不需要分支。
 *
 * 头像墙是「有则显示、无则退化」：数据来自公开 API（可能离线或被限流），拿不到就不显示头像区，
 * 但仓库与社区两个入口始终在。
 */
export function DeveloperCard() {
  const t = useTranslation()
  const capabilities = getPlatformCapabilities()
  const { contributors, isLoading } = useContributors()

  const open = (url: string) => () => capabilities.openExternal(url)

  const contributorsDescription = contributors.length > 0
    ? t('settings.developer.contributorsDescription')
    : isLoading
      ? t('settings.developer.contributorsLoading')
      : t('settings.developer.contributorsEmpty')

  return (
    <Card>
      <SettingsCardHeader
        icon={<Users />}
        title={t('settings.developer.title')}
        description={t('settings.developer.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.developer.repository')}
          description={t('settings.developer.repositoryDescription')}
          control={(
            <Button variant="outline" size="sm" onClick={open(REPOSITORY_URL)}>
              <ExternalLink />
              {t('settings.developer.repositoryAction')}
            </Button>
          )}
        />

        <FormRow
          title={t('settings.developer.community')}
          description={t('settings.developer.communityDescription')}
          control={(
            <Button variant="outline" size="sm" onClick={open(DISCORD_URL)}>
              <ExternalLink />
              {t('settings.developer.communityAction')}
            </Button>
          )}
        />

        <FormRow
          title={t('settings.developer.contributors')}
          description={contributorsDescription}
          control={(
            <>
              {contributors.length > 0 && (
                <AvatarGroup>
                  {contributors.slice(0, 8).map(contributor => (
                    <Avatar key={contributor.login} size="sm" title={contributor.login}>
                      <AvatarImage src={contributor.avatarUrl} alt={contributor.login} loading="lazy" />
                      <AvatarFallback>{contributor.login.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  ))}
                </AvatarGroup>
              )}
              <Button variant="ghost" size="sm" onClick={open(REPOSITORY_CONTRIBUTORS_URL)}>
                {t('settings.developer.contributorsAction')}
              </Button>
            </>
          )}
        />
      </CardContent>
    </Card>
  )
}
