import type { IncomingHttpHeaders } from 'node:http'
import DeviceDetector from 'device-detector-js'
import type { RequestAttributeValueType } from '@common/schemas'

const MAX_VALUE_LENGTH = 4096
const USER_AGENT_MAX_LENGTH = 1024
const detector = new DeviceDetector({ skipBotDetection: true })

export interface RequestAttributeInput {
  key: string
  value: string
  valueType: RequestAttributeValueType
}

export function collectRequestAttributes(headers: IncomingHttpHeaders): RequestAttributeInput[] {
  const attributes: RequestAttributeInput[] = []
  const userAgent = normalizeHeaderValue(headers['user-agent'])
  const source = normalizeHeaderValue(headers['x-one-switch-source'])

  if (userAgent) {
    const normalizedUserAgent = normalizeValue(userAgent, USER_AGENT_MAX_LENGTH)
    attributes.push({ key: 'request.user_agent', value: normalizedUserAgent, valueType: 'string' })
    const parsed = detector.parse(normalizedUserAgent)
    const client = identifyClient(normalizedUserAgent, parsed)
    attributes.push({ key: 'client.category', value: client.category, valueType: 'string' })
    if (client.name) attributes.push({ key: 'client.name', value: client.name, valueType: 'string' })
    if (client.version) attributes.push({ key: 'client.version', value: client.version, valueType: 'string' })
    addAttribute(attributes, 'os.name', parsed.os?.name === 'Mac' ? 'Mac OS' : parsed.os?.name)
    addAttribute(attributes, 'os.version', parsed.os?.version)
    addAttribute(attributes, 'device.type', normalizeDeviceType(parsed))
    addAttribute(attributes, 'device.vendor', parsed.device?.brand)
    addAttribute(attributes, 'device.model', parsed.device?.model)
    if (parsed.client?.type === 'browser') {
      addAttribute(attributes, 'browser.name', parsed.client.name)
      addAttribute(attributes, 'browser.version', parsed.client.version)
      if ('engine' in parsed.client) {
        addAttribute(attributes, 'engine.name', parsed.client.engine)
        addAttribute(attributes, 'engine.version', parsed.client.engineVersion)
      }
    }
    addAttribute(attributes, 'cpu.architecture', parsed.os?.platform)
  } else {
    attributes.push({ key: 'client.category', value: 'unknown', valueType: 'string' })
  }

  if (source) attributes.push({ key: 'request.source', value: normalizeValue(source), valueType: 'string' })
  return attributes
}

function addAttribute(attributes: RequestAttributeInput[], key: string, value: string | undefined): void {
  if (value) attributes.push({ key, value: normalizeValue(value), valueType: 'string' })
}

function normalizeValue(value: string, maxLength = MAX_VALUE_LENGTH): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLength)
}

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function identifyClient(userAgent: string, parsed: DeviceDetector.DeviceDetectorResult): { category: string; name: string | null; version: string | null } {
  const knownClients: Array<[RegExp, string, string]> = [
    [/claude[- ]code\/?([\d.]+)?/i, 'Claude Code', 'ai-client'],
    [/cursor\/?([\d.]+)?/i, 'Cursor', 'ai-client'],
    [/windsurf\/?([\d.]+)?/i, 'Windsurf', 'ai-client'],
    [/openai[- ](?:python|node)\/?([\d.]+)?/i, 'OpenAI SDK', 'sdk'],
    [/anthropic[- ]python\/?([\d.]+)?/i, 'Anthropic SDK', 'sdk'],
    [/curl\/?([\d.]+)?/i, 'curl', 'cli'],
    [/wget\/?([\d.]+)?/i, 'Wget', 'cli'],
    [/postmanruntime\/?([\d.]+)?/i, 'Postman', 'custom'],
  ]

  for (const [pattern, name, category] of knownClients) {
    const match = userAgent.match(pattern)
    if (match) return { category, name, version: match[1] ?? null }
  }
  if (parsed.client?.type === 'browser') return { category: 'browser', name: parsed.client.name, version: parsed.client.version }
  if (parsed.client?.type === 'library') return { category: 'sdk', name: parsed.client.name, version: parsed.client.version }
  if (parsed.client?.name) return { category: 'custom', name: parsed.client.name, version: parsed.client.version }
  const generic = userAgent.match(/^([\w.-]+)(?:\/([\w.+-]+))?/)
  return { category: generic ? 'custom' : 'unknown', name: generic?.[1] ?? null, version: generic?.[2] ?? null }
}

function normalizeDeviceType(parsed: DeviceDetector.DeviceDetectorResult): string | undefined {
  const type = parsed.device?.type
  if (!type) return undefined
  if (type === 'desktop') return type
  if (type === 'tablet' || type === 'smartphone' || type === 'phablet' || type === 'feature phone') return 'mobile'
  return type
}
