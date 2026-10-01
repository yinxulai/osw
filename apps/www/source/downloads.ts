// 站点的外部链接常量：构建期注入的版本号 + 发布页 / 仓库 / 文档站的永久地址。
//
// 这一版**不做**站内分发（不代理安装包、不按平台挑文件）：只有一个公共按钮，直接跳
// GitHub 的最新 release 页，用户在那里按平台自取。好处是站点不需要跟发版同步任何状态
// ——旧版本页面的按钮跳到的是当时的最新版，而不是一个可能已经 404 的固定路径。

// 由 `vite.config.ts` 的 `define` 注入（见 `vite-env.d.ts`），来源为仓库根 `package.json` 的 `version`。
// 只用于展示；按钮指向的是 `releases/latest`，不依赖这个值。
export const DOWNLOAD_VERSION = __APP_VERSION__

/** GitHub 的「最新发布」永久地址：自动指向最新一个正式发布，仓库里不用维护版本号。 */
export const RELEASE_URL = 'https://github.com/yinxulai/osw/releases/latest'

/** 仓库地址，用于 Hero 的「查看源码」。 */
export const REPO_URL = 'https://github.com/yinxulai/osw'

/** 使用手册站（Clarify 静态站，见 `apps/docs`），部署在独立子域上。 */
export const DOCS_URL = 'https://docs.osw.yinxulai.com'
