export type RuntimeEnvironment = 'development' | 'production'

export interface RuntimeProfile {
  environment: RuntimeEnvironment
  /**
   * 应用名：Electron 的 `app.name`，同时也是 macOS 钥匙串里 `safeStorage` 条目的
   * service 名（`<applicationName> Safe Storage`）。
   *
   * 它是**两种环境的密钥命名空间**：生产用 `OSW`、开发用 `OSW Development`，
   * 于是两条环境各存各的密文，互不干扰（开发环境反复重置数据目录、反复重打包，
   * 不该污染用户真正在用的那一份）。规则只有一条：`applicationName` 必须由本字段
   * 提供，宿主**不得**再调用 `app.setName()` 另取一个值——否则命名空间与文档
   * 对不上，表现为旧的 `safeStorage` 密文解不开。
   */
  applicationName: string
  /**
   * 数据目录名：整份数据的落点，两种宿主形态靠它落到同一个目录里。
   *
   * 规则是 **`<用户主目录>/<这个名字>`**（见 `apps/docs/specs/platform/packaging.md` §5.5）：数据放在
   * 用户主目录根下的隐藏目录，不放平台 appData 目录。两个原因：
   *
   *   1. Windows 的 `%APPDATA%` 是**漫游配置目录**。会持续增长的请求日志与正文进去以后，
   *      在有域控的机器上会被同步到服务器——那是实打实的缺陷，不只是难看。
 *   2. 平台 appData 目录要分三个平台各算一次，是两套宿主实现各自分叉的温床。改成主目录后
 *      平台差异直接消失，两种形态不可能再算出两个不同的目录。
   *
   * 宿主不许写死这个名字的字面量，也不许自己判断平台：`path.join(os.homedir(), 这个名字)`
   * 就是全部实现（App 侧见 `app.setPath('userData', ...)`，命令行侧见
   * `apps/cli/source/host.ts`）。
   */
  dataDirectoryName: string
  proxyPort: number
  managementPort: number
  managementApiUrl: string
}

const PROFILES: Record<RuntimeEnvironment, RuntimeProfile> = {
  development: {
    environment: 'development',
    applicationName: 'OSW Development',
    dataDirectoryName: '.osw-development',
    proxyPort: 19300,
    managementPort: 19301,
    /**
     * 开发期用 `localhost` 而不是 `127.0.0.1`，这一处**不是**风格问题。
     *
     * 开发期控制台由 Vite dev server 从 `http://localhost:5173` 提供（见
     * `packages/console/vite.config.ts` 与 `apps/app/scripts/lib/console-dev-server.mjs`），
     * 而管理服务听在 `127.0.0.1:19301`。`localhost` 与 `127.0.0.1` 在浏览器的**站点**划分里
     * 是两个不同的站点（同源策略看的是「协议 + 主机名 + 端口」，SameSite 看的是「可注册域」），
     * 于是登录应答里的 `Set-Cookie: osw_session=...; SameSite=Lax` 属于**跨站子资源响应**，
     * 浏览器会直接把它丢掉。表现是：登录接口 200、但下一条 `/api/auth/session` 仍然
     * `authenticated: false`，界面判定没登上，把人退回登录页——一个只在浏览器里出现、
     * 用 curl（不执行 SameSite 规则）怎么试都正常的故障。
     *
     * 生产形态不存在这个问题：页面本来就是管理服务自己发出的（`${location.origin}/api`），
     * 天生同源（见 `packages/console/source/api/client.ts` 的 `resolveApiBaseFromEnvironment`）。
     * 所以这个主机名只对开发形态有意义，也别把它改成 `127.0.0.1` 去「统一」——那等于
     * 把开发期的登录重新弄坏一次。
     */
    managementApiUrl: 'http://localhost:19301/api',
  },
  production: {
    environment: 'production',
    applicationName: 'OSW',
    dataDirectoryName: '.osw',
    proxyPort: 9300,
    managementPort: 9301,
    managementApiUrl: 'http://127.0.0.1:9301/api',
  },
}

export function getRuntimeProfile(environment: RuntimeEnvironment): RuntimeProfile {
  return PROFILES[environment]
}
