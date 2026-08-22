const manualModelIds = new Map<string, string>()

export function setManualModel(logicalModelId: string, providerModelId: string | null): void {
  if (providerModelId === null) {
    manualModelIds.delete(logicalModelId)
    return
  }
  manualModelIds.set(logicalModelId, providerModelId)
}

export function getManualModel(logicalModelId: string): string | null {
  return manualModelIds.get(logicalModelId) ?? null
}

export function resetManualModels(): void {
  manualModelIds.clear()
}
