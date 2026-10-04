-- 共享重写规则目录的存储基线（Cloudflare D1 / SQLite）。
--
-- 部署时执行一次：
--
--   pnpm --filter @osw/api exec wrangler d1 execute osw-shared-rules --remote --file apps/apis/schema.sql
--
-- `--remote` 打的是线上库；本地开发用 `wrangler dev` 自带的本地 D1，去掉 `--remote` 即可。
-- 语句本身是幂等的（`IF NOT EXISTS`），重复执行没有副作用——部署流程里不必为它加一层
-- 「建过了没有」的判断。
--
-- ## 为什么只有一张表
--
-- 目录里只有一种东西：一条被发布的规则。没有「发布者」「标签」「点赞」「下载记录」这些表，
-- 因为每一项都会引入一个**可以关联到某台机器**的维度，而这份目录刻意不持有那类信息
-- （见 `packages/contracts/source/shared-rewrite-rules.ts` 的文件头）。
--
-- ## id 是内容的签名
--
-- `id` 由规则内容派生（见 `source/registry/signature.ts`）。同一份内容重复发布得到同一个 id，
-- 于是发布是幂等的：不会把一条好规则堆成很多份，也不会在重复发布时把它的用量清零。
-- 主键直接落在 `id` 上，靠 `INSERT ... ON CONFLICT` 完成幂等，不需要额外的去重查询。
--
-- ## 排名是 usage_count 一种
--
-- 只有一列热度信号，就是「被用过多少次」。没有点赞、没有评分、没有作者维度——它们都要求
-- 目录记住「谁做过什么」，而那正是这份目录不肯记住的东西。

CREATE TABLE IF NOT EXISTS shared_rewrite_rules (
  -- 内容签名（`sha256:<hex>`）。同一份内容恒等，天然是幂等发布的主键。
  id TEXT PRIMARY KEY,

  -- 作者撰写的载荷，原样存成 JSON。目录**不拆解**它：拆成列意味着目录要为规则的每一种
  -- 动作建模，于是本机加一种动作就要改一次表——而目录本来就不该知道规则长什么样。
  payload TEXT NOT NULL,

  -- 名称与说明另存一份**归一化后**的副本，只服务于关键词搜索。它们是 `payload` 的派生视图，
  -- 不进任何响应（响应始终回 `payload` 里那份原文）。
  search_text TEXT NOT NULL,

  -- 被用过多少次。每次「用一条」在这里 +1；它不指向任何机器。
  usage_count INTEGER NOT NULL DEFAULT 0,

  -- 毫秒时间戳。`created_time` 在幂等发布时**不改**——一条规则的资历由它第一次出现的时间
  -- 决定，不是最后一次被谁重新发布的时间。
  created_time INTEGER NOT NULL,
  updated_time INTEGER NOT NULL
);

-- 排名读的是「按用量降序、同量按新旧降序」。这条索引让那一页不必全表排序。
CREATE INDEX IF NOT EXISTS idx_shared_rewrite_rules_usage
  ON shared_rewrite_rules (usage_count DESC, updated_time DESC);

-- 「最近」那一页读的是 updated_time。
CREATE INDEX IF NOT EXISTS idx_shared_rewrite_rules_recent
  ON shared_rewrite_rules (updated_time DESC);
