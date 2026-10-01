/**
 * 本地 ESLint 插件：禁止硬编码中文文案。
 *
 * i18n 迁移的漏网之鱼几乎全是「新写的字符串忘了走目录」——类型系统看不见它们，
 * 加一条「中文即报错」的门禁才拦得住。豁免范围刻意写得窄：
 * 注释本来就不是字符串，目录文件是文案的家，测试里的中文是断言而非界面文案，
 * 预设图数据是「用户数据」而不是界面文案（见 `apps/docs/product/i18n.md` 的 i18n 边界）。
 *
 * 为什么住在 console：这条规则管的是「用户可见文案」，而用户可见文案的主要产地是控制台
 * 界面；宿主侧（托盘、原生对话框）的文案同样受管，但只是副产品。
 */

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function report(context, node, text) {
  if (!text || !CJK_PATTERN.test(text)) return
  context.report({ node, messageId: 'hardcoded' })
}

const noHardcodedCjk = {
  meta: {
    type: 'problem',
    docs: {
      description: '不允许在代码里硬编码中文文案，应改为通过目录取词',
    },
    schema: [],
    messages: {
      hardcoded: '硬编码中文文案：请改用目录取词（t(\'…\') / createAppTranslator()）或把文案放进 @common/i18n/catalogs。',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string') report(context, node, node.value)
      },
      TemplateElement(node) {
        report(context, node, node.value.raw)
      },
      JSXText(node) {
        report(context, node, node.value)
      },
    }
  },
}

export default {
  meta: { name: 'i18n', version: '1.0.0' },
  rules: { 'no-hardcoded-cjk': noHardcodedCjk },
}
