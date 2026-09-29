import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { useRouteBreadcrumbs } from '@/routing/route-breadcrumbs'

export interface PageBreadcrumb {
  label: string
  onClick?: () => void
}

interface BreadcrumbsContextValue {
  breadcrumbs: PageBreadcrumb[]
  setPageBreadcrumb: Dispatch<SetStateAction<string | undefined>>
}

interface PageBreadcrumbsProviderProps {
  children: ReactNode
}

const BreadcrumbsContext = createContext<BreadcrumbsContextValue | null>(null)

export function PageBreadcrumbsProvider(props: PageBreadcrumbsProviderProps) {
  const routeBreadcrumbs = useRouteBreadcrumbs()
  const navigate = useNavigate()
  const [pageBreadcrumb, setPageBreadcrumb] = useState<string>()

  const breadcrumbs = useMemo(() => {
    const items = pageBreadcrumb
      ? [...routeBreadcrumbs, { label: pageBreadcrumb }]
      : routeBreadcrumbs

    return items.map((item, index) => {
      const to = item.to
      return {
        label: item.label,
        onClick: index < items.length - 1 && to
          ? () => void navigate({ to, search: true })
          : undefined,
      }
    })
  }, [navigate, pageBreadcrumb, routeBreadcrumbs])

  const value = useMemo(() => ({ breadcrumbs, setPageBreadcrumb }), [breadcrumbs, setPageBreadcrumb])

  return <BreadcrumbsContext.Provider value={value}>{props.children}</BreadcrumbsContext.Provider>
}

function useBreadcrumbsContext(): BreadcrumbsContextValue {
  const context = useContext(BreadcrumbsContext)
  if (!context) throw new Error('Page breadcrumbs must be rendered within PageBreadcrumbsProvider')
  return context
}

export function usePageBreadcrumb(label?: string): void {
  const { setPageBreadcrumb } = useBreadcrumbsContext()

  useEffect(() => {
    setPageBreadcrumb(label)
    return () => {
      setPageBreadcrumb(current => current === label ? undefined : current)
    }
  }, [label, setPageBreadcrumb])
}

export function usePageBreadcrumbs(): PageBreadcrumb[] {
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
