import type { CloudBackupKind } from '@common/cloud-backup'
import {
  CONFIG_SNAPSHOT_FILE_NAME,
  CloudSyncConfigureRequestSchema,
  type CloudSyncConfigureRequest,
  type CloudSyncPullResult,
  type CloudSyncPushResult,
  type CloudSyncStatus,
  type CloudSyncTransferSummary,
  type ConfigSnapshot,
} from '@common/cloud-sync'
import { AppError } from '@server/errors'
import { getSettings, updateSettings } from '@server/database/settings-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { cloudBackupCredentialReference, getCloudBackupProvider, listCloudBackupDescriptors } from './backends'
import type { CloudBackupProvider } from './backends/contract'
import { exportConfigSnapshot } from './export-config-snapshot'
import { importConfigSnapshot } from './import-config-snapshot'
import { decodeSnapshotDocument } from './snapshot-codec'

/**
 * 云同步的编排层：把「设置 + 密钥库 + 当前承载方式」拼成界面要的那几个动作。
 *
 * 这一层**不认识任何具体后端**：它只调用 `CloudBackupProvider` 上那几个动作，
 * 「Gist」「WebDAV」这些词一个都不该出现在这里。接一种新的承载方式时，改动应该落在
 * `backends/` 下新增的一个文件与注册表里的一行，而不是这里。
 */

/** 当前生效的现场：用哪个后端、以谁的身份、对着哪个远端。 */
interface CloudBackupContext {
  provider: CloudBackupProvider
  credential: string
  target: string
}

export async function getCloudSyncStatus(): Promise<CloudSyncStatus> {
  const settings = await getSettings()
  const provider = getCloudBackupProvider(settings.cloudSyncProvider)
  const target = settings.cloudSyncTarget
  return {
    provider: settings.cloudSyncProvider,
    // 可用后端跟着状态一起回：界面不该自己写死一份列表，那份列表会和注册表悄悄错开。
    providers: listCloudBackupDescriptors(),
    credentialConfigured: (await readCredential(settings.cloudSyncProvider)) !== null,
    accountLabel: settings.cloudSyncAccountLabel,
    target,
    targetUrl: target ? provider.targetUrl(target) : '',
    lastPushedTime: settings.cloudSyncLastPushedTime,
    lastPulledTime: settings.cloudSyncLastPulledTime,
  }
}

/**
 * 换承载方式 / 保存或清除凭据 / 绑定或解绑远端。
 *
 * 三件事都可以在一次请求里做，所以顺序是定死的：**先换方式，再处理凭据与远端**。
 * 界面上的「换同步方式」与「填凭据」可能一次提交，那时凭据属于新的那一种，
 * 不能拿它去问旧后端。
 */
export async function configureCloudSync(body: unknown): Promise<CloudSyncStatus> {
  const request: CloudSyncConfigureRequest = CloudSyncConfigureRequestSchema.parse(body)

  if (request.provider !== undefined) await switchProvider(request.provider)

  const settings = await getSettings()
  if (request.credential !== undefined) await applyCredential(settings.cloudSyncProvider, request.credential)
  if (request.target !== undefined) await applyTarget(settings.cloudSyncProvider, request.target)

  return getCloudSyncStatus()
}

/**
 * 试一次「凭据 + 远端」能不能用，不带动任何数据。
 *
 * 与保存凭据时的校验分开：绑定好远端之后，「这份凭据看得见这个远端吗」是另一件可能出错的事
 * （凭据有效但没勾权限、远端属于别人），需要一个不改动任何东西的问法。
 */
export async function testCloudSync(): Promise<CloudSyncStatus> {
  const context = await requireContext()
  const label = await context.provider.verifyCredential(context.credential)
  if (context.target) {
    // 读一次，确认这份凭据对这个远端有权限；文件在不在这一层不关心。
    await context.provider.readDocument(context, CONFIG_SNAPSHOT_FILE_NAME)
  }
  const settings = await getSettings()
  if (label !== settings.cloudSyncAccountLabel) await updateSettings({ cloudSyncAccountLabel: label })
  return getCloudSyncStatus()
}

/**
 * 把本机配置传上去。
 *
 * 未绑定远端时后端可以自己新建一个并把句柄回填（Gist 就是这样）：让「第一次同步」只需要
 * 点一次按钮，而不是先让用户自己去别处建一个容器、复制句柄、再粘回来。
 */
export async function pushConfigSnapshot(): Promise<CloudSyncPushResult> {
  const context = await requireContext()
  const { snapshot, content } = await exportConfigSnapshot()
  const result = await context.provider.writeDocument(context, { fileName: CONFIG_SNAPSHOT_FILE_NAME, content })

  await updateSettings({
    cloudSyncTarget: result.target,
    cloudSyncLastPushedTime: Date.now(),
    // 新建的容器里不可能有「上次拉取」，把时间一并清零，免得界面显示一个凭空的记录。
    ...(result.created ? { cloudSyncLastPulledTime: 0 } : {}),
  })

  return {
    status: await getCloudSyncStatus(),
    pushed: summarizeSnapshot(snapshot),
    createdTarget: result.created,
  }
}

/**
 * 拉取远端快照并应用。
 *
 * 不先写本地存档再应用：应用本身是幂等的（同一份快照应用两次得到同一状态），
 * 而多留一份中间文件反而会引出「以哪份为准」的新问题。代价是应用中途失败会留下半拉架子，
 * 与供应商导入的取舍一致（见 `import-config-snapshot.ts`）。
 */
export async function pullConfigSnapshot(): Promise<CloudSyncPullResult> {
  const context = await requireContext()
  if (!context.target) {
    throw new AppError('CLOUD_SYNC_NOT_CONFIGURED', 400, 'Nothing bound yet: upload once to create one')
  }

  const content = await context.provider.readDocument(context, CONFIG_SNAPSHOT_FILE_NAME)
  if (content === null) {
    throw new AppError('CLOUD_SYNC_REMOTE_FILE_MISSING', 404, `The remote location has no ${CONFIG_SNAPSHOT_FILE_NAME}`, {
      details: { fileName: CONFIG_SNAPSHOT_FILE_NAME },
    })
  }

  const { exportedAt, imported } = await importConfigSnapshot(parseSnapshotContent(content))
  await updateSettings({ cloudSyncLastPulledTime: Date.now() })

  return { status: await getCloudSyncStatus(), pulled: imported, exportedAt }
}

/**
 * 换一种承载方式。
 *
 * 旧绑定与两个时间戳都属于上一个后端（一个 Gist id 当 WebDAV 目录毫无意义），一起清掉；
 * 凭据则按 `kind` 分开存在密钥库里，所以换回来还能用。
 */
async function switchProvider(kind: CloudBackupKind): Promise<void> {
  const settings = await getSettings()
  if (settings.cloudSyncProvider === kind) return
  await updateSettings({
    cloudSyncProvider: kind,
    cloudSyncTarget: '',
    cloudSyncAccountLabel: '',
    cloudSyncLastPushedTime: 0,
    cloudSyncLastPulledTime: 0,
  })
}

/**
 * 保存或清除凭据。
 *
 * 保存时**先联网校验再落库**：一个错的凭据如果能存进去，用户要等到第一次上传才会发现，
 * 而那时报错离他刚才的操作已经很远了。校验顺带拿到账号名，界面因此能立刻显示「已连接为谁」。
 */
async function applyCredential(kind: CloudBackupKind, raw: string): Promise<void> {
  const credential = raw.trim()
  const reference = cloudBackupCredentialReference(kind)
  if (credential.length === 0) {
    await getSecretStore().delete(reference)
    await updateSettings({ cloudSyncAccountLabel: '' })
    return
  }
  const label = await getCloudBackupProvider(kind).verifyCredential(credential)
  await getSecretStore().set(reference, credential)
  await updateSettings({ cloudSyncAccountLabel: label })
}

/**
 * 绑定或解绑远端。
 *
 * 换一个远端就把「上次同步时间」清零：那两行时间属于旧远端的历史，留着会让人以为
 * 新绑定的那个已经同步过了。
 */
async function applyTarget(kind: CloudBackupKind, raw: string): Promise<void> {
  const settings = await getSettings()
  const target = getCloudBackupProvider(kind).normalizeTarget(raw)
  if (target === settings.cloudSyncTarget) return
  await updateSettings({ cloudSyncTarget: target, cloudSyncLastPushedTime: 0, cloudSyncLastPulledTime: 0 })
}

/** 要动手（读写远端）之前都得先凑齐现场；凭据没配好就明确报「还没配好」。 */
async function requireContext(): Promise<CloudBackupContext> {
  const settings = await getSettings()
  const credential = await readCredential(settings.cloudSyncProvider)
  if (!credential) {
    throw new AppError('CLOUD_SYNC_NOT_CONFIGURED', 400, `No ${settings.cloudSyncProvider} credential saved yet`)
  }
  return {
    provider: getCloudBackupProvider(settings.cloudSyncProvider),
    credential,
    target: settings.cloudSyncTarget,
  }
}

async function readCredential(kind: CloudBackupKind): Promise<string | null> {
  const credential = await getSecretStore().get(cloudBackupCredentialReference(kind))
  return credential && credential.length > 0 ? credential : null
}

/** 数一遍快照里带了多少东西，用于给用户一句「搬了多少」。 */
function summarizeSnapshot(snapshot: ConfigSnapshot): CloudSyncTransferSummary {
  return {
    providers: snapshot.providers.length,
    models: snapshot.providers.reduce((total, provider) => total + provider.models.length, 0),
    logicalModels: snapshot.logicalModels.length,
    bindings: snapshot.bindings.length,
  }
}

/**
 * 把远端的文件正文解析成对象。
 *
 * 两步都在这里，顺序不能反：先把整份 base64 解回 JSON 正文（`snapshot-codec.ts`，顺便兼容
 * 之前没编码过的旧文件），再解析 JSON。两种失败分开报——「解不出编码」与「解出来不是 JSON」
 * 是两种不同的坏文件，用户要改的地方也不一样。
 */
function parseSnapshotContent(content: string): unknown {
  try {
    return JSON.parse(decodeSnapshotDocument(content))
  } catch (error) {
    // 编码错误本身就是 `CLOUD_SYNC_REMOTE_FILE_INVALID`，直接放它过去，别包成一句 JSON 报错。
    if (error instanceof AppError) throw error
    throw new AppError(
      'CLOUD_SYNC_REMOTE_FILE_INVALID',
      502,
      `${CONFIG_SNAPSHOT_FILE_NAME} at the remote location is not valid JSON after base64 decoding`,
      { cause: error, details: { fileName: CONFIG_SNAPSHOT_FILE_NAME } },
    )
  }
}
