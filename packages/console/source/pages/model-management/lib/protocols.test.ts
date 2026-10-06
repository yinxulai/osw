import { describe, expect, it } from 'vitest'
import { ProtocolSchema } from '@common/schemas'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import { PROTOCOL_EXAMPLES, PROTOCOL_OPTIONS, PROTOCOL_PLACEHOLDERS } from './protocols'

/*
 * 协议选择器的三张静态表。
 *
 * 它们看起来只是「填数据」，但每一张都有必须成立的理由：
 *
 *  - **下拉选项的顺序**就是用户在界面上看到的顺序，必须是协议枚举自己的顺序（新增协议时
 *    不该靠手工往数组里插一行，那样迟早会漏）；
 *  - **展示名来自契约层**：服务端的错误文案（「端点缺地址：OpenAI Responses」）用的是同一份名字，
 *    界面另写一份的话，同一个协议在错误提示与下拉框里会变成两个名字；
 *  - **占位符必须是该协议真正能用的地址**，写错的占位符比没有占位符更糟：用户会照抄它。
 */

const ALL_PROTOCOLS = ProtocolSchema.options

describe('协议下拉选项', () => {
  it('顺序与协议枚举一致，一个不漏一个不多', () => {
    expect(PROTOCOL_OPTIONS.map(option => option.value)).toEqual([...ALL_PROTOCOLS])
  })

  it('展示名取自契约层（服务端错误文案用的是同一份）', () => {
    for (const option of PROTOCOL_OPTIONS) {
      expect(option.label).toBe(PROTOCOL_DISPLAY_NAMES[option.value])
    }
  })

  it('展示名就是正式叫法，不做本地化', () => {
    expect(PROTOCOL_OPTIONS.map(option => option.label)).toEqual([
      'OpenAI Completions',
      'OpenAI Responses',
      'Anthropic Messages',
    ])
  })
})

describe('地址占位符', () => {
  it('每个协议都有占位符，且都是 https 的完整端点地址（不是基址）', () => {
    for (const protocol of ALL_PROTOCOLS) {
      const placeholder = PROTOCOL_PLACEHOLDERS[protocol]
      expect(placeholder).toBeTruthy()
      expect(placeholder).toMatch(/^https:\/\//)
    }
  })

  it('占位符指向的是各家自己的端点，不能三个协议共用一条', () => {
    const placeholders = ALL_PROTOCOLS.map(protocol => PROTOCOL_PLACEHOLDERS[protocol])
    expect(new Set(placeholders).size).toBe(ALL_PROTOCOLS.length)
  })
})

describe('地址示例', () => {
  it('每个协议都有示例，且每条示例都带 provider 与 url', () => {
    for (const protocol of ALL_PROTOCOLS) {
      const examples = PROTOCOL_EXAMPLES[protocol]
      expect(examples.length).toBeGreaterThan(0)
      for (const example of examples) {
        expect(example.provider).toBeTruthy()
        expect(example.url).toMatch(/^https?:\/\//)
      }
    }
  })

  it('示例里的第一条就是该协议官方端点，与占位符一致（用户照着抄即能跑通）', () => {
    for (const protocol of ALL_PROTOCOLS) {
      expect(PROTOCOL_EXAMPLES[protocol][0].url).toBe(PROTOCOL_PLACEHOLDERS[protocol])
    }
  })

  it('本地部署的示例标注了 providerKey（品牌名没法翻「本机 xxx」，得走目录）', () => {
    const local = PROTOCOL_EXAMPLES['openai-completions'].find(example => example.url.includes('localhost'))
    expect(local?.providerKey).toBe('providers.example.ollamaLocal')
    expect(local?.provider).toBe('Ollama')
  })

  it('云端示例不带 providerKey：品牌名原样显示', () => {
    const cloud = PROTOCOL_EXAMPLES['anthropic-messages']
    expect(cloud.every(example => example.providerKey === undefined)).toBe(true)
  })
})
