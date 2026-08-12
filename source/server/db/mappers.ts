import {
  LogicalModelSchema,
  ModelBindingSchema,
  ProviderSchema,
  type LogicalModel,
  type ModelBinding,
  type Provider,
} from '@common/schemas'

type DatabaseRow = Record<string, unknown>

export function mapProviderRow(row: unknown): Provider {
  const value = row as DatabaseRow
  return ProviderSchema.parse({ ...value, enabled: Boolean(value.enabled) })
}

export function mapLogicalModelRow(row: unknown): LogicalModel {
  const value = row as DatabaseRow
  return LogicalModelSchema.parse({ ...value, enabled: Boolean(value.enabled) })
}

export function mapBindingRow(row: unknown): ModelBinding {
  const value = row as DatabaseRow
  return ModelBindingSchema.parse({ ...value, enabled: Boolean(value.enabled) })
}
