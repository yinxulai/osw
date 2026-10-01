# 文档索引

`docs/` 分两半，**两边不互相复制**：

- [`product/`](./product/README.md)：本仓库自己的设计结论（产品规格、行为契约、验收标准），产品侧的唯一权威。回答「我们决定怎么做」。
- [`references/`](./references/)：上游厂商公开 API 文档的逐字快照，只回答「上游到底怎么定义的」。

## 上游协议参考目录

| 文件 | 上游接口 | 规模 | 采集来源 |
|------|---------|------|---------|
| [references/anthropic-messages.md](./references/anthropic-messages.md) | Anthropic Messages API（`POST /v1/messages`、token 计数、全部域类型） | 约 32k 行 | `https://platform.claude.com/docs/en/api/messages` |
| [references/openai-completions.md](./references/openai-completions.md) | OpenAI Chat Completions（`POST /chat/completions`） | 约 2.5k 行 | `https://developers.openai.com/api/reference/resources/chat` |
| [references/openai-responses.md](./references/openai-responses.md) | OpenAI Responses API（`POST /responses`） | 约 16.6k 行 | `https://developers.openai.com/api/reference/resources/responses` |

## 用途

这三份文档是**协议转换器唯一的外部依据**：

- 实现：[`packages/core/source/proxy/protocols/shared/`](../packages/core/source/proxy/protocols/shared/)
- 转换矩阵（哪些方向存在）：[`conversion-registry.ts`](../packages/core/source/proxy/protocols/shared/conversion-registry.ts)
- 产品侧语义（转换开关、候选过滤、失败语义、流式状态机约定）：[`product/protocol-conversion.md`](./product/protocol-conversion.md)

字段级争议以这里的定义为最终裁决：某个字段能不能映射、枚举值取哪几个、usage 该不该相加，都应当能在下面三份文件里找到对应条目。反过来，参考文档里没有写的东西（例如 Responses 快照未收录的事件名）不得在实现里凭印象发明。

## 约定

1. **逐字快照，不做本地改写。** 只允许补 frontmatter（`title` / `url`）与顶层标题，正文、枚举、措辞、示例一律保持上游原文。
2. **只增不改。** 上游更新时整份覆盖重采集，不在文件里追加本地批注或删减「用不到」的段落。
3. **引用方式。** 代码与单测注释里写 `docs/references/<file>.md` 加字段名，不复制大段原文。
4. **正文结构统一。** 三份文件都是「接口正文（Headers → Body parameters → Returns → Example）+ 类型定义（Domain types）」两段式，用标题层级检索，不额外维护目录表。

## 检索方式

三份文件都用标题层级检索，**不维护行号索引**——行号在整份重采集后必然失效，需要定位时直接按下面的标题关键词搜。

通用层次：接口级 `## Create …` → 请求章节 `### Body Parameters` → 响应章节 `### Returns` → `### Example` → 类型定义 `## Domain types`。

| 用途 | 检索关键词 |
|------|-----------|
| Anthropic 主接口 / 域类型 / 批处理 | `## Create a Message` / `## Domain types` / `## Count tokens in a Message` / `## Messages › Batches` |
| Chat Completions 参数与返回 | `## Create chat completion` / `### Body Parameters` / `### Returns` |
| Chat Completions 专题 | `### Functions`（工具调用）/ `### Image input` / `### Logprobs` / `### Streaming`（chunk 形态） |
| Responses 参数与返回 | `## Create a model response` / `### Body Parameters` / `### Returns` |
| Responses 专题 | `### Functions` / `### Reasoning` / `### Image input` / `### File input` / `### File search` / `### Text input` / `### Web search` / `### Streaming`（逐事件 `data:` 示例） |

跨文件字段查询建议用 grep，例如：`rg -n '^### Body Parameters' docs/references` 或直接搜字段名（`max_completion_tokens`、`StopReason`、`input_tokens_details`）。
