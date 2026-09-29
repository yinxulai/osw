import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'

export interface PageBreadcrumb {
  label: string
  onClick?: () => void
}

interface BreadcrumbsContextValue {
  breadcrumbs: PageBreadcrumb[]
  setBreadcrumbs: Dispatch<SetStateAction<PageBreadcrumb[]>>
}

interface PageBreadcrumbsProviderProps {
  children: ReactNode
}

const EMPTY_BREADCRUMBS: PageBreadcrumb[] = []
const BreadcrumbsContext = createContext<BreadcrumbsContextValue | null>(null)

export function PageBreadcrumbsProvider(props: PageBreadcrumbsProviderProps) {
  const [breadcrumbs, setBreadcrumbs] = useState<PageBreadcrumb[]>(EMPTY_BREADCRUMBS)
  const value = useMemo(() => ({ breadcrumbs, setBreadcrumbs }), [breadcrumbs])

  return <BreadcrumbsContext.Provider value={value}>{props.children}</BreadcrumbsContext.Provider>
}

function useBreadcrumbsContext(): BreadcrumbsContextValue {
  const context = useContext(BreadcrumbsContext)
  if (!context) throw new Error('Page breadcrumbs must be rendered within PageBreadcrumbsProvider')
  return context
}

export function usePageBreadcrumbs(items?: PageBreadcrumb[]): void {
  const { setBreadcrumbs } = useBreadcrumbsContext()
  const currentItems = items ?? EMPTY_BREADCRUMBS
  const itemsRef = useRef(currentItems)
  itemsRef.current = currentItems
  // 页面每次渲染都会新建数组，但真正影响顶栏结构的是标签顺序；
  // 点击回调通过 ref 读取最新值，不需要参与 effect 依赖。
  const signature = currentItems.map((item, index) => `${index}:${item.label}`).join('\u001f')

  useEffect(() => {
    setBreadcrumbs(itemsRef.current)
    return () => {
      setBreadcrumbs(current => current === itemsRef.current ? EMPTY_BREADCRUMBS : current)
    }
  }, [setBreadcrumbs, signature])
}

export function usePageBreadcrumbsValue(): PageBreadcrumb[] {
  return useBreadcrumbsContext().breadcrumbs
}

interface BreadcrumbTrailProps {
  items: PageBreadcrumb[]
  className?: string
}

export function BreadcrumbTrail(props: BreadcrumbTrailProps) {
  const t = useTranslation()

  return (
    <nav
      aria-label={t('nav.breadcrumb')}
      className={cn('flex min-w-0 items-center gap-1', props.className)}
    >
      {props.items.map((item, index) => {
        const isLast = index === props.items.length - 1
        return (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 && <ChevronRight className="size-3 shrink-0 text-text-quaternary" aria-hidden="true" />}
            <span className={cn('flex min-w-0 items-center gap-1', isLast ? 'text-text-secondary' : 'text-text-tertiary')}>
              {item.onClick ? (
                <button
                  type="button"
                  className="truncate rounded-sm text-left outline-none transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={item.onClick}
                >
                  {item.label}
                </button>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </span>
          </Fragment>
        )
      })}
    </nav>
  )
}
