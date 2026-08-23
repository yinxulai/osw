import type { ApiResponse } from '@common/schemas'

export async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const result = await promise
  if (!result.success) throw new Error(result.errorMessage)
  return result.data
}
