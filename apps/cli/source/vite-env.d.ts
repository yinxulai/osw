/**
 * 构建期注入的常量。
 *
 * 注入点有两处，必须同步：`apps/cli/vite.config.ts` 与 `packages/toolkit/vitest.config.ts`
 * 的 `define`。少任何一处都只在**运行期**变成 `ReferenceError`，没有任何构建期告警
 * ——这与 `apps/app` 的 `__APP_VERSION__` 是同一类坑（见 apps/docs/product/packaging.md §5.8）。
 */
declare const __CLI_VERSION__: string
