import { CloudBackupKindSchema, type CloudBackupDescriptor, type CloudBackupKind } from '@common/cloud-backup'
import type { CloudBackupProvider } from './contract'
import { githubGistProvider } from './github-gist'

/**
 * 承载方式注册表。
 *
 * `Record<CloudBackupKind, CloudBackupProvider>` 是这一层的主要价值：契约里加了新的 kind
 * 却忘了写实现是**编译错误**，而不是运行时某一格悄悄空着。
 *
 * 与供应商预设（console 里 `import.meta.glob` 自动扫描目录）刻意不同：这里要手写一行。
 * 一个后端意味着一条出站通路与一套凭据处理，它不该由「新建了一个文件」顺手带进来，
 * 而应该是一次看得见的决定。
 */
const cloudBackupProviders: Record<CloudBackupKind, CloudBackupProvider> = {
  'github-gist': githubGistProvider,
}

export function getCloudBackupProvider(kind: CloudBackupKind): CloudBackupProvider {
  return cloudBackupProviders[kind]
}

/** 所有可选的承载方式及其自述。顺序即界面下拉的顺序。 */
export function listCloudBackupDescriptors(): CloudBackupDescriptor[] {
  return CloudBackupKindSchema.options.map(kind => cloudBackupProviders[kind].descriptor)
}

/**
 * 凭据在密钥库里的引用。
 *
 * 固定值而不是随机 id（与供应商 API Key 不同）：一台机器上一种承载方式只可能有一份凭据，
 * 给它编一个随机 id 再存进设置里，只会多出一处可以不同步的状态——而且这个 id 一旦每次启动
 * 重新生成，重启后就连自己的凭据都找不到了。用 `kind` 当后缀还顺带保证换后端不会把
 * 上一个后端的凭据弄丢：换回来还在。
 */
export function cloudBackupCredentialReference(kind: CloudBackupKind): string {
  return `cloud_backup_credential.${kind}`
}
