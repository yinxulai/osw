// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import { createDefaultPolicyGraph, samplePayload } from '@common/router/presets'
import { UNSAVED_ROUTER_GRAPH_VERSION, type RouterGraphSnapshot } from '@common/router/types'
import { createQueryFixture } from '@/test-support'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { RouterPage } from './page'

const t = createAppTranslator('en')

// `I18nProvider` 会读取服务端设置；页面还从同一份设置里读当前生效的路由模式
// （`settings.routeMode` 由 schema 兜底成 `workflow`，所以这里给 `null` 就落到工作流这一支）。
// 单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({
  useSettings: () => null,
  useSettingsLoading: () => false,
}))

// 逻辑模型列表来自服务端；工作台只把它交给预设与试运行，不参与下面这几条断言。
vi.mock('@/data/logical-models', () => ({ useLogicalModels: () => [] }))

/**
 * 图只有服务端一份。这里替掉接口，给出「一版都没保存过」时的内建默认策略：
 * 画布首帧就该是代理此刻执行的那张图，而不是一张空白骨架。
 */
const snapshot: RouterGraphSnapshot = {
  graph: createDefaultPolicyGraph([]),
  id: null,
  version: UNSAVED_ROUTER_GRAPH_VERSION,
  savedAt: 0,
}

vi.mock('@/api/router', () => ({
  routerApi: {
    getGraph: async () => ({ success: true, data: snapshot }),
    getGraphVersions: async () => ({ success: true, data: [] }),
    getGraphVersion: async () => ({ success: true, data: null }),
    saveGraph: vi.fn(),
    run: vi.fn(),
  },
}))

// 页头（`PageHeader`）读的是「当前层级」列表，而层级来自路由。这一层只关心页头画出来的标题
// 与动作，因此直接替掉面包屑这一小块，不必在单测里搭一个路由。
vi.mock('@/components/breadcrumbs', () => ({
  BreadcrumbTrail: () => null,
  usePageBreadcrumbs: () => [{ label: 'Routing' }, { label: 'Workflow' }],
  usePageBreadcrumb: () => {},
}))

// jsdom 没有实现 `ResizeObserver`，而画布用它盯住自己的宽度（节点面板的拖动范围按它算）。
// 空实现即可：这里不验宽度，只验这一层真的把图画出来了。
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver)

/** 画布与抽屉都读 React Query 的缓存，因此这一层带上共用夹具给的 QueryClient。 */
function renderPage() {
  const { wrapper } = createQueryFixture()
  return render(
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider><RouterPage /></TooltipProvider>
      </ToastProvider>
    </I18nProvider>,
    { wrapper },
  )
}

/**
 * 工作台页的渲染层最小集。
 *
 * 这一页此前只有「JSX 逐字搬移 + typecheck + 纯逻辑单测」兜底，没有任何渲染层断言；
 * 这里只钉住**进页面第一眼必须成立**的几件事：画布在、加节点在、页头两个主动作在、
 * 试运行抽屉能开。再细的交互（加节点、连线、保存版本）都已有各自的单测，不在这里重复。
 */
describe('workflow studio', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('mounts the canvas with its dock and the header actions', async () => {
    const view = renderPage()

    // 画布本体：React Flow 的根节点挂上了，说明这一层真的把图交给了画布。
    expect(view.container.querySelector('.react-flow')).not.toBeNull()
    // 「加节点」是进工作台后的第一个动作，它在悬浮控制条上，必须够得着。
    expect(screen.getByRole('button', { name: t('router.canvas.addNodeAria') })).toBeTruthy()
    // 页头动作：试运行与保存。保存的可用状态由页面按「画布与生效版本是否一致」算好，
    // 这里只断言它们挂出来了，不重复断言那个判断（那是纯逻辑单测的事）。
    expect(await screen.findByRole('button', { name: t('router.workflow.run') })).toBeTruthy()
    expect(screen.getByRole('button', { name: t('router.save') })).toBeTruthy()
  })

  it('opens the run drawer from the header', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: t('router.workflow.run') }))

    // 抽屉挂在 portal 里，所以按屏幕查而不是在渲染容器里查。
    // 里要有输入框与结论区：这两样出现才算真的开了，而不只是状态变了。
    expect(await screen.findByText(t('router.runPanel.description'))).toBeTruthy()
    const payload = await screen.findByRole('textbox') as HTMLTextAreaElement
    // 输入框预填的是示例负载（逻辑模型在点运行时才注入，不在文本里）。
    expect(JSON.parse(payload.value)).toEqual(samplePayload)
  })
})
