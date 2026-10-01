/**
 * 脚本示例与起始脚本的**再导出**。
 *
 * 定义已经搬到 `@common/rewrite-script-samples`，因为它们是服务端会真正执行的代码模板，
 * `@osw/core` 的测试必须拿得到同一份字符串才能做执行覆盖（见那个文件顶部的说明）。
 * 这里保留同名再导出，是为了让页面侧的 import 路径与语义不变：调用方看到的仍然是
 * 「这个页面的脚本示例库」，而不是被迫知道它住哪个包。
 */

export {
  CONDITIONAL_CODE,
  defaultRewriteScript,
  DROP_BODY_FIELD_CODE,
  FILTER_HEADERS_CODE,
  PRESET_CONDITIONAL_SCRIPT_CODE,
  REQUEST_BASELINE_CODE,
  RESPONSE_BASELINE_CODE,
  REWRITE_SCRIPT_SAMPLES,
} from '@common/rewrite-script-samples'
export type { RewriteScriptSample, RewriteScriptStage } from '@common/rewrite-script-samples'
