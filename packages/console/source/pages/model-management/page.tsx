import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { AsyncState } from '@/components/async-state'
import { useTranslation } from '@/i18n/provider'
import { useAppUiStore } from '@/store/app-ui-store'
import { useModelManagementService } from './service'
import { ProviderDialogs } from './components/provider-dialogs'
import { ProviderLoading } from './components/provider-loading'
import { ProviderPageActions } from './components/provider-page-actions'
import { ProviderWorkspace } from './components/provider-workspace'

export function ModelManagementPage() {
  const service = useModelManagementService()
  const t = useTranslation()
  // 面板是外壳级的（见 `App.tsx`），这里只负责把开关拨过去——不再持有任何面板状态。
  const openTestPanel = useAppUiStore(state => state.setTestPanelOpen)
  const hasProviders = service.providers.length > 0

  return (
    <PageLayout>
      <PageHeader
        title={t('providers.title')}
        description={t('providers.description')}
        actions={(
          <ProviderPageActions
            providerCount={service.providers.length}
            onImport={service.openImportFilePicker}
            onExportAll={() => service.openExportDialog({ kind: 'all' })}
            onOpenTestPanel={() => openTestPanel(true)}
            onCreate={() => service.openProviderDialog()}
          />
        )}
      />
      <PageContent>
        <AsyncState
          loading={service.loading}
          error={hasProviders ? null : service.error}
          errorTitle={t('providers.loadFailed')}
          onRetry={() => void service.reload()}
          loadingFallback={<ProviderLoading />}
        >
          <ProviderWorkspace service={service} />
        </AsyncState>
        <ProviderDialogs service={service} />
      </PageContent>
    </PageLayout>
  )
}
