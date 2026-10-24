import { useMemo, useState } from 'react'
import { CheckCircle2, Loader2, PlugZap, RefreshCw, XCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField, FormGroup, FormHint, FORM_DIALOG_BODY_CLASSNAME } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { FetchedModelPicker } from './fetched-model-picker'
import { ModelProtocolEndpointCard } from './model-protocol-endpoint-card'
import { ProviderRuleBindings } from './provider-rule-bindings'
import { ProviderIcon } from './provider-icon'
import type { FetchedProviderModel } from '@/api/providers'
import type { Provider } from '@common/schemas'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import type { ModelConnectivityTest } from '../hooks/use-model-connectivity-test'
import type { ProtocolEndpointEntry } from '../hooks/types'

interface ModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingModel: { id: string; modelName: string } | null
  providers: Provider[]
  providerId: string
  providerName: string
  onSelectProvider: (providerId: string) => void
  modelId: string
  protocolEntries: ProtocolEndpointEntry[]
  saving: boolean
  fetchedModels: FetchedProviderModel[]
  fetchingModels: boolean
  selectedModelIds: string[]
  onFetchModels: () => void
  setModelId: (id: string) => void
  toggleModelSelection: (id: string, checked: boolean) => void
  selectAllFetchedModels: (ids: string[]) => void
  invertFetchedModels: (ids: string[]) => void
  clearSelectedModels: () => void
  updateProtocolEntry: (index: number, patch: Partial<ProtocolEndpointEntry>) => void
  /** 点「测试连接」时由调用方决定测什么（表单当前启用的那几行），不在对话框里自己拼。 */
  onTestConnectivity: () => void
  /** 上一次探测的状态与逐协议结果。初始态（`idle`）什么都不展示。 */
  connectivityTest: ModelConnectivityTest
  onCancel: () => void
  onSave: () => void
}

export function ModelDialog(props: ModelDialogProps) {
  const {
    open,
    onOpenChange,
    editingModel,
    providers,
    providerId,
    providerName,
    onSelectProvider,
    modelId,
    protocolEntries,
    saving,
    fetchedModels,
    fetchingModels,
    selectedModelIds,
    onFetchModels,
    setModelId,
    toggleModelSelection,
    selectAllFetchedModels,
    invertFetchedModels,
    clearSelectedModels,
    updateProtocolEntry,
    onTestConnectivity,
    connectivityTest,
    onCancel,
    onSave,
  } = props

  const t = useTranslation()
  const canSave = (editingModel ? modelId.trim() : selectedModelIds.length > 0 || modelId.trim()) && protocolEntries.some(entry => entry.enabled)
  // 能不能测：与能不能存同一套条件。这两件事不该有两套规则——
  // 存不了的东西没有可测的对象，而测不了的东西（模型名都空着）也存不下去。
  const canTestConnectivity = canSave && !saving && connectivityTest.status !== 'running'

  const [modelSearch, setModelSearch] = useState('')
  const filteredModels = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase()
    if (!keyword) return fetchedModels
    return fetchedModels.filter(model =>
      model.id.toLowerCase().includes(keyword) ||
      (model.displayName ?? '').toLowerCase().includes(keyword))
  }, [fetchedModels, modelSearch])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{editingModel ? t('models.dialog.editTitle') : t('models.dialog.addTitle')}</DialogTitle>
          <DialogDescription>
            {t('models.dialog.descriptionPrefix')}<span className="font-medium">{providerName}</span>{t('models.dialog.descriptionSuffix')}
          </DialogDescription>
        </DialogHeader>

        <div className={FORM_DIALOG_BODY_CLASSNAME}>
          {/* 供应商：新建时可选，也可以直接把供应商改成另一家；编辑已有模型时不让换家
              （换家等于换一个模型，应该新建），这里只当一行只读说明。 */}
          {editingModel ? (
            <FormField label={t('models.dialog.providerLabel')}>
              <Input value={providerName} readOnly disabled />
            </FormField>
          ) : (
            <FormField label={t('models.dialog.providerLabel')} htmlFor="model-provider">
              <Select value={providerId} onValueChange={onSelectProvider}>
                <SelectTrigger id="model-provider" className="w-full">
                  <SelectValue placeholder={t('models.dialog.providerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {providers.map(provider => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <span className="inline-flex items-center gap-2">
                        <ProviderIcon name={provider.name} size={16} />
                        {provider.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          {/* 模型 ID */}
          <FormField label={t('models.dialog.modelIdLabel')} htmlFor="model-id" hint={t('models.dialog.modelIdHint')}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="model-id"
                value={modelId}
                onChange={event => setModelId(event.target.value)}
                placeholder={t('models.dialog.modelIdPlaceholder')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={fetchingModels}
                onClick={onFetchModels}
                className="h-8 shrink-0"
              >
                <RefreshCw size={13} className={cn(fetchingModels && 'animate-spin')} />
                {fetchingModels ? t('models.dialog.fetching') : t('models.dialog.fetch')}
              </Button>
            </div>

            <FetchedModelPicker
              modelId={modelId}
              multiSelect={!editingModel}
              selectedModelIds={selectedModelIds}
              fetchedModels={fetchedModels}
              modelSearch={modelSearch}
              setModelSearch={setModelSearch}
              setModelId={setModelId}
              toggleModelSelection={toggleModelSelection}
              onSelectAllFiltered={selectAllFetchedModels}
              onInvertFiltered={invertFetchedModels}
              onClearSelection={clearSelectedModels}
              filteredModels={filteredModels}
            />
            {!editingModel && selectedModelIds.length > 0 && (
              <FormHint>{t('models.dialog.selectedHint', { count: selectedModelIds.length })}</FormHint>
            )}
          </FormField>

          {/* 协议端点 */}
          <FormGroup
            title={t('models.dialog.endpointsTitle')}
            description={t('models.dialog.endpointsDescription')}
          >
            {protocolEntries.map((entry, index) => (
              <ModelProtocolEndpointCard
                key={entry.protocol}
                entry={entry}
                index={index}
                updateProtocolEntry={updateProtocolEntry}
              />
            ))}
          </FormGroup>

          {editingModel && <ProviderRuleBindings providerModelId={editingModel.id} embedded />}
        </div>

        {/*
           * 探测结果放在页脚上方、紧挨着按钮：它是「刚点了那个按钮」的产物，
           * 跟里面的表单是两件事——表单是输入，这里是结论。
           * 逐协议一行：三个协议里通了两个，用户要看见的是哪一个没过。
           */}
        {connectivityTest.status !== 'idle' && (
          <div className="grid gap-1">
            {connectivityTest.errorMessage && (
              <Alert variant="destructive" className="border-0 bg-destructive/10">
                <XCircle />
                <AlertDescription>{connectivityTest.errorMessage}</AlertDescription>
              </Alert>
            )}
            {connectivityTest.results.map(result => (
              <Alert
                key={result.protocol}
                variant={result.success ? 'default' : 'destructive'}
                className={cn('border-0', result.success && 'bg-success/10 text-text-success')}
              >
                {result.success ? <CheckCircle2 /> : <XCircle />}
                <AlertDescription className={cn(result.success && 'text-current')}>
                  <span className="font-medium">{PROTOCOL_DISPLAY_NAMES[result.protocol]}</span>
                  {' · '}
                  {result.success
                    ? t('models.dialog.testSuccess', { status: result.statusCode ?? 0, duration: result.durationMilliseconds })
                    : result.errorMessage}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('common.action.cancel')}</Button>
          {/*
           * 测试排在保存前面：先验通、再落库。它是**反悔成本**最低的一个按钮——
           * 测出来不通，用户改地址就行；保存了再发现不通，还得回来改一遍。
           */}
          <Button variant="outline" disabled={!canTestConnectivity} onClick={onTestConnectivity}>
            {connectivityTest.status === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
            {connectivityTest.status === 'running' ? t('models.dialog.testing') : t('models.dialog.test')}
          </Button>
          <Button disabled={saving || !canSave} onClick={onSave}>
            {saving ? t('common.action.saving') : editingModel ? t('models.dialog.save') : selectedModelIds.length > 0 ? t('models.dialog.submitBulk', { count: selectedModelIds.length }) : t('models.dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
