/**
 * 仓库与社区的外部链接常量。
 *
 * 界面里所有指向 GitHub 仓库、发布页、社区（Discord）的入口都取这里的值：这些地址会同时
 * 出现在设置页的「开发者」卡片、更新卡片的兜底跳转等多个地方，散落成字面量迟早会对不齐。
 * 一律用 `getPlatformCapabilities().openExternal(url)` 打开（见 `platform/capabilities.ts`），
 * 不要在组件里直接写 `window.electronAPI`。
 */

/** 仓库的 `owner/name`。用于拼 GitHub API、contrib.rocks 这类按仓库寻址的外部资源。 */
export const REPOSITORY_SLUG = 'yinxulai/osw'

/** 仓库主页。 */
export const REPOSITORY_URL = `https://github.com/${REPOSITORY_SLUG}`

/** GitHub 的「最新发布」永久地址：自动指向最新一个正式发布，仓库里不用维护版本号。 */
export const REPOSITORY_RELEASES_URL = `${REPOSITORY_URL}/releases/latest`

/** 贡献者榜单页；头像墙的「查看全部」跳这里。 */
export const REPOSITORY_CONTRIBUTORS_URL = `${REPOSITORY_URL}/graphs/contributors`

/** 提 issue 的入口。 */
export const REPOSITORY_ISSUES_URL = `${REPOSITORY_URL}/issues`

/** 社区入口：Discord 邀请链接，是用户提问与交流的主场。 */
export const DISCORD_URL = 'https://discord.gg/7TcyC2Bmy'
