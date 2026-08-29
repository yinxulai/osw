export interface FormattedContent {
  value: string
  isJson: boolean
}

interface CapturedStreamingBody {
  schemaVersion?: unknown
  chunks?: unknown
}

export function formatContent(value: string): FormattedContent {
  try {
    const parsed = JSON.parse(value) as CapturedStreamingBody
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.chunks) && parsed.chunks.every(chunk => typeof chunk === 'string')) {
      return { value: parsed.chunks.join(''), isJson: true }
    }
    return { value: JSON.stringify(parsed, null, 2), isJson: true }
  } catch {
    return { value, isJson: false }
  }
}
