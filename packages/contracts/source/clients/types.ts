/**
 * 客户端注册表的**形状**。
 *
 * 这里只有类型，没有数据：每个客户端自己的那一份定义住在 `clients/<key>/definition.json`
 * （同目录还有 `icon.svg` / icon.light|dark.svg），由同级 `clients.ts` 汇总。一个客户端一个
 * 目录，形状与数据分家——新增/修改一个客户端只动它自己的那个目录。
 *
 * 定义用的是 **JSON 而不是 TS**：它的消费者是**渲染进程**（控制台），JSON 能被静态 import，
 * 于是图标才能用 `import.meta.glob` 按目录扫出来；而契约包（也会被 Node / Worker 消费）
 * 不能依赖打包器能力，那条扫描只能放在控制台。官方文档与来源写在目录里的 `README.md`，
 * 不再是 TS 的文件头注释。
 */

/** 客户端原生使用的上游协议。不确定时不填，避免编造。 */
export type AgentClientProtocol = 'anthropic-messages' | 'openai-responses' | 'openai-completions'

/**
 * 支持的操作系统，与 Node 的 `process.platform` 取值一致。
 *
 * 只列我们真正会分平台处理的三种：加一个值意味着 `platformPaths` 与
 * `declaredPathForPlatform` 都得跟着说清它在那个平台上落在哪。
 */
export type AgentClientPlatform = 'darwin' | 'linux' | 'win32'

/** 配置文件的格式，决定读写时用哪套解析/序列化。 */
export type AgentClientConfigFormat = 'json' | 'jsonc' | 'toml' | 'yaml' | 'env'

/**
 * 文件内部的**存储形状**——字段声明识别出来的键，落到字节上是怎么摆的。
 *
 * 这一层是「字段语义」与「存储格式」的解耦点：`fields[].path` 只表达**逻辑路径**
 * （`agent-loop.model` 这样的点号写法），它该怎么在这份文件里被找到、创建、改写，
 * 由格式编辑器按 `shape` 来解释。于是同一份声明能落在不同的存储形状上，而注册表
 * 不必知道「这文件里其实是一条按 id 定位的补丁列表」这类细节。
 *
 * 缺省是 `{ kind: 'map' }`：绝大多数配置文件就是一棵嵌套映射，逻辑路径逐段即键。
 * 注册表不需要为这种最常见的情形写任何东西。
 */
export type AgentClientFileShape =
  /** 一棵嵌套映射：逻辑路径的每一段都是（或将成为）这一层的键。 */
  | { kind: 'map' }
  /**
   * 一条**按 id 定位的条目列表**：顶层是若干条目，每条有一个标识键与一段载荷。
   *
   * DeepSeek Harness 的 `config.yaml` 就是这个形状——一串 `{ id, config }`，工具按 `id`
   * 找到对应行、用整段 `config` 覆盖该行的配置。读写这类文件时，逻辑路径的**第一段是条目
   * 的 id**，其余段是条目内部的路径（`agent-loop.model` → 条目 `agent-loop` 里那一处）。
   * 同名条目按「最后一条为准」处理，与工具自己的行为一致。
   */
  | { kind: 'patchList'; idField?: string; payloadField?: string }
  /**
   * 顶层是**条目对象的列表**，没有载荷层：逻辑路径的**第一段是条目的标识值**（按 `idField`
   * 命中），其余段是条目对象内部的路径。
   *
   * VS Code 的 `chatLanguageModels.json` 就是这个形状——根是一个数组，每个元素是一个
   * provider 对象（`{ name, vendor, models: [...] }`），`name` 就是它的标识。与 `patchList`
   * 的区别在于这一层是**对象数组**且条目本身就是配置（没有 `{ id, config }` 那层壳），
   * 路径只写「哪一条 + 里面哪个键」。缺省标识键是 `name`。
   */
  | { kind: 'entryList'; idField?: string }

/** 注册表里的一个字段在自动填充时被当成什么来写。 */
export type AgentClientFieldRole =
  /** 指向本地服务的基础地址。 */
  | 'baseUrl'
  /** 本地服务不校验的调用方凭证。 */
  | 'apiKey'
  /** 主模型。 */
  | 'model'
  /** 小模型/后台模型，留空时回落主模型。 */
  | 'smallModel'
  /** 指向 provider 表项的 id。 */
  | 'provider'
  /** provider 表项本身（对象）。 */
  | 'providerEntry'
  /** 需要置为 true 的布尔标记（如 Cursor 的 `hasChangedDefaultModel`）。 */
  | 'flagTrue'

/**
 * 表单上要用户决定的两个模型槽位，见 `agentClientModelSlots`。
 *
 * 单独切出一个类型而不是复用 `AgentClientFieldRole`：界面按槽位渲染行、按槽位回读初值，
 * 而「基础地址」这类角色永远不会成为一行（它由服务端固定写入），编译器应该替我们把这件事说清。
 */
export type AgentClientModelSlot = Extract<AgentClientFieldRole, 'model' | 'smallModel'>

/**
 * 模板里一个值：字面量，或者一个 `{{占位符}}`。
 *
 * 刻意用**纯数据**而不是函数表达「provider 表项长什么样」：它是这个客户端的一条事实，
 * 和「它读哪个文件、有哪些键」属于同一份清单，分开住在两个包里只会让两边慢慢走样，
 * 而控制台也没法拿一个函数去渲染表单。
 */
export type AgentClientTemplateValue = string | number | boolean | null | AgentClientTemplateValue[] | { [key: string]: AgentClientTemplateValue }

/** 模板里可以引用的实值。 */
export interface AgentClientTemplateContext {
  /** 本机服务的监听地址。 */
  baseUrl: string
  /** 那个固定样例密钥。 */
  apiKey: string
  /** 用户选定的主模型。 */
  model: string
  /** 用户选定的小模型（已回落到主模型）。 */
  smallModel: string
  /** 见 `clients.ts` 的 `LOCAL_PROVIDER_ID`。 */
  providerId: string
  /** 见 `clients.ts` 的 `LOCAL_PROVIDER_NAME`。 */
  providerName: string
}

export interface AgentClientProviderEntryTemplate {
  /** 表项路径的点号写法；`{{providerId}}` 会被换成本地 provider id。 */
  path: string
  /** 表项骨架，键与值里的占位符在写入前统一替换。 */
  template: Record<string, AgentClientTemplateValue>
}

/**
 * 「把这个客户端的配置指到本机服务」的配方。
 *
 * 为什么注册表里那点声明不够、还需要这一块：注册表描述「这些键存在、它们是这个意思」，
 * 而改配置还需要知道注册表不该关心的事——哪些键应当**一起**被覆盖（Claude Code 的
 * `opus/sonnet/haiku` 别名必须跟着改，否则用户切一下别名就跑到真实 Anthropic 去了）、
 * provider 表项长什么样、以及哪些键**必须放过**（推理档位、认证方式是用户自己的取舍）。
 */
export interface AgentClientApplyConfig {
  /** 注册表 `fields[].key` → 要写什么。没列出的 key 不写。 */
  roles: Record<string, AgentClientFieldRole>
  /** 明确放过、但确实属于这个客户端的键（有意的「不碰」清单）。 */
  ignored: string[]
  /** 模型字段的值前缀，如 OpenCode 要求 `provider/model`。 */
  modelPrefix?: string
  /** provider 表项的路径与模板。 */
  providerEntry?: AgentClientProviderEntryTemplate
}

/** 一个配置文件里的可寻址设置项，即该工具 schema 的一段。 */
export interface AgentClientFieldDefinition {
  /** 语义名：model / provider / effort / small … */
  key: string
  /** 配置文件里的键路径（点号分隔；`<id>` 表示动态键）。 */
  path: string
  /**
   * 这个字段属于哪个文件（注册表里的 `files[].path`）。
   *
   * 缺省时归属**第一个文件**，因为绝大多数客户端只有一份配置文件带设置项。
   * 必须写死的场合是「一份客户端的设置项分散在两个文件里」：不写 `file` 的话，
   * 改后一个文件时会连带往它里面写本属于前一个文件的键，写出一个工具根本不读的键。
   */
  file?: string
  /** 值类型。 */
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
  /** 作用说明。 */
  description: string
}

/** 覆盖某个文件所在**目录**的环境变量。 */
export interface AgentClientEnvOverride {
  /** 环境变量名，如 `DSH_HOME`、`XDG_CONFIG_HOME`。 */
  name: string
  /**
   * 它替换掉的 `~/` 相对前缀。
   *
   * 必须写死这一层，不能只记变量名：同样是 XDG，`XDG_CONFIG_HOME` 替换的是 `~/.config`，
   * 而 `XDG_DATA_HOME` 替换的是 `~/.local/share`（两层）——只替换一层就会把 Auth 文件
   * 指到 `$XDG_DATA_HOME/opencode/auth.json`，而 XDG 规范里那个 `share` 是不带的。
   */
  replaces: string
}

/** 该客户端的一个配置文件。备份/自动管理据此定位与解析。 */
export interface AgentClientFileDefinition {
  /**
   * 主目录相对路径，以 `~/` 开头（`~` 由消费者展开为真实主目录）。
   *
   * 这也是这个文件的**身份**：备份、版本、界面上的标签、字段归属都用它，调用方给的
   * `filePath` 必须与它逐字相等才被受理（见 `findAgentClientFile`）。所以它是**规范路径**
   * ——多个平台各写一份时（见 `platformPaths`），这里写 macOS 那一份，其余平台覆盖它。
   */
  path: string
  /**
   * 同一个文件在**其它平台**上的路径。缺省平台回落 `path`。
   *
   * 只给「同一份配置在不同系统上落在不同目录」的客户端用（VS Code 的 `chatLanguageModels.json`
   * 就在 `Library/Application Support` / `.config` / `AppData/Roaming` 三个位置各住一份）。
   * 与 `path` 一样必须是 `~/` 相对路径；`envVar` 的覆盖仍然作用于选中的那一条。
   *
   * `path` 依旧是身份：界面与所有 API 传的、备份与版本挂的都还是 `path`，这个字段只在
   * **把身份展开成真实路径**的那一步（`resolveClientConfigPath`）按当前平台换一份。
   */
  platformPaths?: Partial<Record<AgentClientPlatform, string>>
  /** 文件格式。 */
  format: AgentClientConfigFormat
  /**
   * 文件内部的存储形状（见 `AgentClientFileShape`）。缺省为 `{ kind: 'map' }`。
   *
   * 这一层把「字段该怎么被找到」从 `fields[].path` 里分出来：`path` 只写逻辑路径，
   * 存储形状（嵌套映射、还是按 id 定位的条目列表）由这里声明、由格式编辑器解释。
   */
  shape?: AgentClientFileShape
  /** 该文件的**目录**可被这个环境变量覆盖（如 `DSH_HOME`、`XDG_CONFIG_HOME`）。 */
  envVar?: AgentClientEnvOverride
  /**
   * 这个文件要**由 OSW 自己加载进登录 shell**（缺省不加载）。
   *
   * 专门给「只能靠环境变量配置的客户端」用——那些客户端把地址/凭证读自进程环境，
   * 没有任何配置文件能承载它们（Copilot CLI 走 `COPILOT_PROVIDER_*`）。这类客户端
   * 由 OSW 维护一份 `env` 文件（`KEY=VALUE` 行），并在登录 shell 的启动文件里留一个
   * 带哨兵标记的 `source` 块来加载它；Windows 下改写成 PowerShell `$PROFILE` 里的对应片段。
   *
   * 带这个标记的文件**不是**工具自己的配置文件，是 OSW 的投递产物：工具不读它，是登录
   * shell 把它加载进进程环境后工具才看到那些变量。所以它由 OSW 全权维护（写入时会在文件
   * 顶部加一句「由 OSW 生成」的注释），不受 `files[].envVar` 改道。
   */
  load?: boolean
  /** 该文件在工具里的作用。 */
  purpose: string
}

export interface AgentClientDefinition {
  key: string
  name: string
  aliases?: string[]
  /**
   * 展示权重：**数值大的排前面**。
   *
   * 仅用于客户端之间的排序（与内置供应商的 `order` 同义）。
   */
  order: number
  /** 官网。用于「看文档 / 装工具」这类跳转。 */
  websiteUrl?: string
  /** 一句话描述这个客户端。 */
  description: string
  /** 原生协议；不确定时缺省。 */
  protocol?: AgentClientProtocol
  /** 主目录下的配置目录。备份时按目录归档。 */
  configDir: string
  /** 该客户端的配置文件清单。 */
  files: AgentClientFileDefinition[]
  /** 需要识别/改写的设置项。 */
  fields: AgentClientFieldDefinition[]
  /**
   * 「把配置指到本机服务」的配方。缺省表示自动填充不可用，详情页因此**不摆**「要写入的模型」那一块。
   *
   * 缺省是指**没有可指向本地服务的地址字段**——这个客户端没有任何地址或 provider
   * 表可以改写。这种情况下界面不摆空表单，而是让用户直接编辑文件，并在这一页给出
   * 地址与受理路径（见控制台的 `AddressCard` / `ProtocolCard`）。目前注册表里每个客户端
   * 都有配方，所以这一档暂时为空。
   *
   * 另外两种曾经看起来像「否决理由」的情况都**不成立**：
   *   - **跨文件**：只要给字段标上 `file`、把 provider 表项挂在正确的文件上，配方照样能用（见 Pi）。
   *   - **存储形状**：`patchList`（按 id 定位的条目列表）这类形状已由
   *     `AgentClientFileDefinition.shape` 声明、由格式编辑器解释，配方本身只管「往哪个逻辑路径写什么」。
   *
   * 于是「配方空缺」现在只剩一种成因：这个客户端确实没有地址字段可写。以前这里还列过「配方没核对准」
   * 一类（DeepSeek Harness），核实其运行期可写面后已成为正常条目。
   */
  apply?: AgentClientApplyConfig
}
