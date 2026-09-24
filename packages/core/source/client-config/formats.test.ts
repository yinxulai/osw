import { describe, expect, it } from 'vitest'
import { ConfigParseError, createConfigEditor, supportsAutoFill } from './formats'

/**
 * 配置编辑器。
 *
 * 这层唯一的硬指标是**不许弄坏别人的文件**：只动目标键、未触及的行（注释、缩进、键顺序）
 * 一字不动。所以下面很多断言看的是「原文里还有什么」而不是「解析出来的对象长什么样」——
 * 用户下次 review 自己的配置时，diff 里只该出现我们真正改的那一行。
 */

describe('format support', () => {
  it('autofills the formats that have a structured writer', () => {
    expect(supportsAutoFill('json')).toBe(true)
    expect(supportsAutoFill('jsonc')).toBe(true)
    expect(supportsAutoFill('env')).toBe(true)
    expect(supportsAutoFill('toml')).toBe(true)
    // YAML 没有写入器（见 `docs/product/` 里的取舍）：只做备份、手动编辑与历史版本。
    expect(supportsAutoFill('yaml')).toBe(false)
  })

  it('refuses to create an editor for yaml', () => {
    expect(() => createConfigEditor('yaml', '')).toThrow(ConfigParseError)
  })
})

describe('json editor', () => {
  it('reads scalars and ignores non-scalars', () => {
    const editor = createConfigEditor('json', '{"model":"gpt-5","enabled":true,"tuning":{"a":1},"tags":["a"]}')

    expect(editor.get('model')).toBe('gpt-5')
    expect(editor.get('enabled')).toBe('true')
    // 对象/数组不是「一个值」：返回 `null` 而不是把它序列化成字符串回显出去。
    expect(editor.get('tuning')).toBeNull()
    expect(editor.get('tags')).toBeNull()
    expect(editor.get('missing')).toBeNull()
  })

  it('treats an empty file as an empty object', () => {
    const editor = createConfigEditor('json', '')
    expect(editor.serialize()).toBe('{}\n')
  })

  it('creates missing intermediate objects when writing a dotted path', () => {
    const editor = createConfigEditor('json', '{"model":"gpt-5"}')

    editor.set('env.ANTHROPIC_BASE_URL', 'http://127.0.0.1:9300')

    expect(JSON.parse(editor.serialize())).toEqual({
      model: 'gpt-5',
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9300' },
    })
  })

  it('keeps the keys it did not touch in their original order', () => {
    const editor = createConfigEditor('json', '{"model":"gpt-5","permissions":{"allow":["Read"]},"theme":"dark"}')

    editor.set('model', 'osw/gpt-5')
    const serialized = editor.serialize()

    expect(serialized.indexOf('"model"')).toBeLessThan(serialized.indexOf('"permissions"'))
    expect(serialized.indexOf('"permissions"')).toBeLessThan(serialized.indexOf('"theme"'))
    expect(serialized).toContain('"Read"')
    expect(serialized.endsWith('\n')).toBe(true)
  })

  it('writes a whole object at a concrete path', () => {
    const editor = createConfigEditor('json', '{"provider":{"anthropic":{}}}')

    editor.setObject('provider.osw', { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:9300' } })

    expect(JSON.parse(editor.serialize()).provider).toEqual({
      anthropic: {},
      osw: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:9300' } },
    })
  })

  it('reads a dynamic `<id>` segment as "no value"', () => {
    const editor = createConfigEditor('json', '{"provider":{"osw":{"name":"One Switch"}}}')
    expect(editor.get('provider.<id>.name')).toBeNull()
  })

  it('refuses to guess at broken json', () => {
    expect(() => createConfigEditor('json', '{"model":')).toThrow(ConfigParseError)
    expect(() => createConfigEditor('json', '[1,2]')).toThrow(ConfigParseError)
    expect(() => createConfigEditor('json', '42')).toThrow(ConfigParseError)
    // jsonc 走同一条路：JSON.parse 认不下注释时按「解析失败」处理，而不是去猜注释。
    expect(() => createConfigEditor('jsonc', '{\n  // note\n  "model": "a"\n}')).toThrow(ConfigParseError)
  })
})

describe('env editor', () => {
  const text = '# loaded by the CLI\nGOOGLE_GEMINI_BASE_URL=https://example.com\nexport GEMINI_API_KEY="sk-1"\n'

  it('reads plain, exported and quoted values', () => {
    const editor = createConfigEditor('env', text)

    expect(editor.get('GOOGLE_GEMINI_BASE_URL')).toBe('https://example.com')
    expect(editor.get('GEMINI_API_KEY')).toBe('sk-1')
    expect(editor.get('MISSING')).toBeNull()
  })

  it('replaces the matching line without disturbing the rest', () => {
    const editor = createConfigEditor('env', text)

    editor.set('GEMINI_API_KEY', 'sk-2')

    expect(editor.serialize()).toBe('# loaded by the CLI\nGOOGLE_GEMINI_BASE_URL=https://example.com\nGEMINI_API_KEY=sk-2\n')
  })

  it('appends a missing key after a blank line, quoting values that need it', () => {
    const editor = createConfigEditor('env', text)

    editor.set('OSW_NOTE', 'has space')

    expect(editor.serialize()).toBe(`${text}\nOSW_NOTE="has space"\n`)
  })

  it('quotes empty values so the key stays readable', () => {
    const editor = createConfigEditor('env', 'A=1\n')
    editor.set('B', '')
    expect(editor.serialize()).toBe('A=1\n\nB=""\n')
  })

  it('refuses to write a nested object', () => {
    const editor = createConfigEditor('env', 'A=1\n')
    expect(() => editor.setObject('B', { nested: 'x' })).toThrow(ConfigParseError)
  })
})

describe('toml editor', () => {
  const text = [
    '# my codex setup',
    'model = "gpt-5"',
    'model_provider = "openai"',
    '',
    '[model_providers.openai]',
    'name = "OpenAI"',
    'base_url = "https://api.openai.com/v1"',
    '',
  ].join('\n')

  it('reads root keys and section keys', () => {
    const editor = createConfigEditor('toml', text)

    expect(editor.get('model')).toBe('gpt-5')
    expect(editor.get('model_providers.openai.name')).toBe('OpenAI')
    expect(editor.get('model_providers.openai.missing')).toBeNull()
    expect(editor.get('missing')).toBeNull()
  })

  it('does not read an array as a value', () => {
    const editor = createConfigEditor('toml', 'tags = ["a", "b"]\n')
    expect(editor.get('tags')).toBeNull()
  })

  it('replaces a root key in place', () => {
    const editor = createConfigEditor('toml', text)

    editor.set('model_provider', 'osw')

    const serialized = editor.serialize()
    expect(serialized).toContain('# my codex setup')
    expect(serialized).toContain('model_provider = "osw"')
    expect(serialized).not.toContain('"openai"\n\n[model_providers.openai]')
    expect(serialized).toContain('[model_providers.openai]')
  })

  it('inserts a new root key above the first table', () => {
    const editor = createConfigEditor('toml', text)

    editor.set('model_reasoning_effort', 'high')

    const lines = editor.serialize().split('\n')
    expect(lines.indexOf('model_reasoning_effort = "high"')).toBeLessThan(lines.indexOf('[model_providers.openai]'))
  })

  it('appends a new table with its scalar body', () => {
    const editor = createConfigEditor('toml', text)

    editor.setObject('model_providers.osw', {
      name: 'One Switch',
      base_url: 'http://127.0.0.1:9300',
      wire_api: 'responses',
    })

    const serialized = editor.serialize()
    expect(serialized).toContain('[model_providers.openai]')
    expect(serialized).toContain(
      '[model_providers.osw]\nname = "One Switch"\nbase_url = "http://127.0.0.1:9300"\nwire_api = "responses"\n',
    )
  })

  it('replaces the scalar body of an existing table', () => {
    const editor = createConfigEditor('toml', text)

    editor.setObject('model_providers.openai', { name: 'One Switch' })

    const serialized = editor.serialize()
    expect(serialized).toContain('[model_providers.openai]\nname = "One Switch"')
    // 旧表里的标量整段换掉，不留半截（TOML 没有「删除键」这种操作）。
    expect(serialized).not.toContain('api.openai.com')
    expect(serialized).toContain('# my codex setup')
  })

  it('refuses a table value that is not a scalar', () => {
    const editor = createConfigEditor('toml', text)
    expect(() => editor.setObject('model_providers.osw', { name: 'One Switch', models: { a: {} } })).toThrow(ConfigParseError)
  })
})
