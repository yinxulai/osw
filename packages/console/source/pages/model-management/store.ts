import { createPageScratchStore } from '@/store/page-scratch'

interface ModelManagementUiState {
  selectedProviderId: string
  setSelectedProviderId: (id: string) => void
}

/**
 * 这一页记进草稿的只有「上次点开的是哪个供应商」。
 *
 * 用户从供应商列表进到它的模型，切去别的页看一眼再回来，应该还停在原来那个供应商上；
 * 关掉窗口就回到空，让「第一个供应商」这条自动选中规则重新跑一遍。
 */
type PersistedModelManagementScratch = Pick<ModelManagementUiState, 'selectedProviderId'>

const scratch = createPageScratchStore<ModelManagementUiState, PersistedModelManagementScratch>({
  page: 'model-management',
  create: set => ({
    selectedProviderId: '',
    setSelectedProviderId: selectedProviderId => set({ selectedProviderId }),
  }),
  pick: state => ({ selectedProviderId: state.selectedProviderId }),
  defaults: { selectedProviderId: '' },
})

export const useModelManagementUiStore = scratch.store
/** 丢掉「上次点开的是哪个供应商」（测试复位、以及「重新看一遍」时用）。 */
export const resetModelManagementScratch = scratch.reset
