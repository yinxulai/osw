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
  it('autofills every format that has a structured writer', () => {
    expect(supportsAutoFill('json')).toBe(true)
    expect(supportsAutoFill('jsonc')).toBe(true)
    expect(supportsAutoFill('env')).toBe(true)
    expect(supportsAutoFill('toml')).toBe(true)
    expect(supportsAutoFill('yaml')).toBe(true)
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

  it('keeps every byte it did not change, besides the one value it rewrote', () => {
    const text = '{"model":"gpt-5","permissions":{"allow":["Read"]},"theme":"dark"}'
    const editor = createConfigEditor('json', text)

    editor.set('model', 'osw/gpt-5')

    // 单行原文里不该冒出换行或缩进：改的只有那一个值，其余字符原样交还。
    expect(editor.serialize()).toBe('{"model":"osw/gpt-5","permissions":{"allow":["Read"]},"theme":"dark"}')
  })

  it('keeps the original indentation instead of reformatting the file', () => {
    const text = ['{', '    "model": "gpt-5",', '', '    "permissions": {', '        "allow": ["Read"]', '    }', '}', ''].join('\n')
    const editor = createConfigEditor('json', text)

    editor.set('model', 'osw/gpt-5')

    // 四空格还是四空格、空行还在、末尾换行没变——一份没被我们重排过的文件，diff 里就只有一行。
    expect(editor.serialize()).toBe(text.replace('"gpt-5"', '"osw/gpt-5"'))
  })

  it('inserts a new key following the indentation the file already uses', () => {
    const editor = createConfigEditor('json', '{\n    "model": "gpt-5"\n}\n')

    const before = editor.set('permissions', 'Read')

    expect(before).toBeNull()
    expect(editor.serialize()).toBe('{\n    "model": "gpt-5",\n    "permissions": "Read"\n}\n')
    expect(JSON.parse(editor.serialize()).permissions).toBe('Read')
  })

  it('writes an object at the same indentation the file already gives its neighbours', () => {
    const editor = createConfigEditor('json', '{\n  "model": "gpt-5",\n  "provider": {\n    "anthropic": {}\n  }\n}\n')

    editor.setObject('provider.osw', { npm: '@ai-sdk/openai-compatible', models: { 'gpt-5': {} } })

    expect(editor.serialize()).toBe(
      '{\n  "model": "gpt-5",\n  "provider": {\n    "anthropic": {},\n    "osw": {\n      "npm": "@ai-sdk/openai-compatible",\n      "models": {\n        "gpt-5": {}\n      }\n    }\n  }\n}\n',
    )
  })

  it('writes the same object again without changing a byte', () => {
    const editor = createConfigEditor('json', '{\n  "model": "osw/my-model",\n  "provider": {}\n}\n')
    editor.setObject('provider.osw', { npm: 'x', models: { 'osw/my-model': {} } })
    const first = editor.serialize()

    // 一键生效会算两遍（预览 + 落盘），第二遍必须认出「这就是我们上一次写的」，
    // 否则每点一次按钮都会多出一版内容相同的历史。
    const again = createConfigEditor('json', first)
    const before = again.setObject('provider.osw', { npm: 'x', models: { 'osw/my-model': {} } })

    expect(again.serialize()).toBe(first)
    expect(JSON.parse(before!)).toEqual({ npm: 'x', models: { 'osw/my-model': {} } })
  })

  it('appends to a single-line table with a comma, not a newline', () => {
    const editor = createConfigEditor('json', '{"a":1,"b":2}')

    editor.set('c', 3)

    // 单行表追加也只动一个位置：逗号与键值紧贴着接上去，不引入原文没有的空白。
    expect(editor.serialize()).toBe('{"a":1,"b":2,"c":3}')
  })

  it('keeps an object that was written on one line on one line', () => {
    const editor = createConfigEditor('json', '{\n  "name": "CLI",\n  "permissions": { "allow": ["Read"] }\n}\n')

    editor.setObject('permissions', { allow: ['Read', 'Write'] })

    // 原文把 `permissions` 写在一行，我们写回的也在一行：不因为它是个对象就抻成四行。
    expect(editor.serialize()).toBe('{\n  "name": "CLI",\n  "permissions": {"allow":["Read","Write"]}\n}\n')
  })

  it('builds the whole chain of missing objects in one edit', () => {
    const editor = createConfigEditor('json', '{\n  "model": "gpt-5"\n}\n')

    editor.set('env.ANTHROPIC_BASE_URL', 'http://127.0.0.1:9300')

    expect(editor.serialize()).toBe('{\n  "model": "gpt-5",\n  "env": {\n    "ANTHROPIC_BASE_URL": "http://127.0.0.1:9300"\n  }\n}\n')
  })

  it('rewrites only the value of a nested key', () => {
    const editor = createConfigEditor('json', '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",\n    "ANTHROPIC_AUTH_TOKEN": "sk-1"\n  }\n}\n')

    const before = editor.set('env.ANTHROPIC_BASE_URL', 'http://127.0.0.1:9300')

    expect(before).toBe('https://api.anthropic.com')
    expect(editor.serialize()).toBe('{\n  "env": {\n    "ANTHROPIC_BASE_URL": "http://127.0.0.1:9300",\n    "ANTHROPIC_AUTH_TOKEN": "sk-1"\n  }\n}\n')
  })

  it('refuses to clobber a value the user put where it wanted an object', () => {
    // `env` 不是对象：以前这里会把用户的整个值替换成 `{}` 再往里写。
    const editor = createConfigEditor('json', '{"env":"https://api.anthropic.com","model":"gpt-5"}')

    expect(() => editor.set('env.ANTHROPIC_BASE_URL', 'http://127.0.0.1:9300')).toThrow(ConfigParseError)
    // 报错之前一个字节都不该改：`serialize()` 交出来的仍是原文。
    expect(editor.serialize()).toBe('{"env":"https://api.anthropic.com","model":"gpt-5"}')
  })

  it('refuses a dotted path whose parent is not an object', () => {
    // 与 `env` 那条同一道闸，只是这次中间层在更里面：报错要说清是哪一层挡住的。
    const editor = createConfigEditor('json', '{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}')

    expect(() => editor.set('env.ANTHROPIC_BASE_URL.x', 'y')).toThrow(/"env.ANTHROPIC_BASE_URL" is not an object/)
    expect(editor.serialize()).toBe('{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}')
  })

  it('refuses to write a whole object under a parent that is not an object', async () => {
    // `setObject` 走的是另一条路（先改对象再改文本），但不能因为路不同就放松同一道闸。
    const editor = createConfigEditor('json', '{"env":"https://api.anthropic.com"}')

    expect(() => editor.setObject('env.ANTHROPIC_BASE_URL', { a: 1 })).toThrow(/"env" is not an object/)
    expect(editor.serialize()).toBe('{"env":"https://api.anthropic.com"}')
  })

  it('treats a whitespace-only file as an empty object', () => {
    const editor = createConfigEditor('json', '  \n\n')

    editor.set('model', 'gpt-5')

    // 只有空白等于什么都没写：整份文档由我们生成，而不是去空白里找一个 `{`。
    expect(editor.serialize()).toBe('{\n  "model": "gpt-5"\n}\n')
  })

  it('writes a whole chain into a file that has nothing at all', () => {
    // 文件还不存在（或空着）时，连根对象都得我们补：`env.ANTHROPIC_BASE_URL` 要写成
    // `{"env":{"ANTHROPIC_BASE_URL":…}}`，而不是把键平铺在根上。
    const editor = createConfigEditor('json', '')

    editor.set('env.ANTHROPIC_BASE_URL', 'http://127.0.0.1:9300')

    expect(editor.serialize()).toBe('{\n  "env": {\n    "ANTHROPIC_BASE_URL": "http://127.0.0.1:9300"\n  }\n}\n')
  })

  it('keeps an array value in one piece', () => {
    const editor = createConfigEditor('json', '{\n  "permissions": {\n    "allow": ["Read"]\n  }\n}\n')

    editor.setObject('permissions', { allow: ['Read', 'Bash(git status)'], deny: ['Bash(rm -rf *)'] })

    // 数组整块重写：`["Read","Bash(git status)"]` 里的逗号与括号不属于定位信号。
    expect(JSON.parse(editor.serialize()).permissions).toEqual({ allow: ['Read', 'Bash(git status)'], deny: ['Bash(rm -rf *)'] })
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

  it('leaves the file alone when the path has no segment at all', () => {
    // 界面上一个没填的输入框会送出一条空路径：那不是一个「名字为空的键」，是无事可做。
    const text = '{"model":"gpt-5"}'
    const editor = createConfigEditor('json', text)

    expect(editor.set('', 'x')).toBeNull()
    expect(editor.set('.', 'x')).toBeNull()
    expect(editor.setObject('', { a: 1 })).toBeNull()
    expect(editor.serialize()).toBe(text)
  })

  it('grows a tab-indented file with a tab', () => {
    const editor = createConfigEditor('json', '{\n\t"model": "gpt-5"\n}\n')

    const before = editor.set('permissions', 'Read')

    // 缩进单位取自原文而不是写死两空格：一份 Tab 缩进的配置不该因为我们的插入冒出空格。
    expect(before).toBeNull()
    expect(editor.serialize()).toBe('{\n\t"model": "gpt-5",\n\t"permissions": "Read"\n}\n')
  })

  it('fills an empty table that was written on one line', () => {
    const editor = createConfigEditor('json', '{"provider":{}}')

    editor.set('provider.name', 'One Switch')

    expect(editor.serialize()).toBe('{"provider":{"name":"One Switch"}}')
  })

  it('keeps the spacing around a number it rewrites', () => {
    const editor = createConfigEditor('json', '{ "count": 1 }')

    const before = editor.set('count', 2)

    // 数字值后面的空白属于原文：替换一个数字不该顺手把行尾的空格剪掉。
    expect(before).toBe('1')
    expect(editor.serialize()).toBe('{ "count": 2 }')
  })

  it('rewrites a key while escaped neighbours sit around it', () => {
    const editor = createConfigEditor('json', '{"path":"C:\\\\logs\\\\a.json","note":"say \\"hi\\"","model":"gpt-5"}')

    editor.set('model', 'osw/gpt-5')

    // 值里的 `\\` 与 `\"` 不参与定位：扫描器跳过字符串，只动 model 那一段。
    expect(JSON.parse(editor.serialize())).toEqual({ path: 'C:\\logs\\a.json', note: 'say "hi"', model: 'osw/gpt-5' })
  })

  it('matches a key that the user wrote with an escape', () => {
    const editor = createConfigEditor('json', '{"a\\u0062":"gpt-5"}')

    expect(editor.get('ab')).toBe('gpt-5')

    editor.set('ab', 'osw/gpt-5')

    // `"a\u0062"` 就是 `ab`：键名带转义时也要认得出、改得对。
    expect(JSON.parse(editor.serialize())).toEqual({ ab: 'osw/gpt-5' })
  })

  it('refuses to guess at broken json', () => {
    expect(() => createConfigEditor('json', '{"model":')).toThrow(ConfigParseError)
    // 普通 JSON 客户端要的是**对象**根：根是数组时属于另一种形状，不能当对象写。
    expect(() => createConfigEditor('json', '[1,2]')).toThrow(ConfigParseError)
    expect(() => createConfigEditor('json', '42')).toThrow(ConfigParseError)
    // jsonc 走同一条路：JSON.parse 认不下注释时按「解析失败」处理，而不是去猜注释。
    expect(() => createConfigEditor('jsonc', '{\n  // note\n  "model": "a"\n}')).toThrow(ConfigParseError)
  })
})

/**
 * 「条目数组」形状：根是一个对象数组，每个条目用某个字段当标识。
 *
 * VS Code 的 `chatLanguageModels.json` 就是这种——`[{ "name": "osw", ... }]`。写的时候只能命中
 * `name` 相等的那一条，绝不能碰用户已经放进去的其它 provider。
 */
describe('json entry-list editor', () => {
  const shape = { kind: 'entryList' as const, idField: 'name' }

  it('reads members of the entry matched by the id field', () => {
    const editor = createConfigEditor('json', '[{"name":"other","apiKey":"x"},{"name":"osw","apiKey":"sk-1"}]', shape)

    expect(editor.get('osw.apiKey')).toBe('sk-1')
    expect(editor.get('missing.apiKey')).toBeNull()
  })

  it('treats an empty file as an empty array', () => {
    const editor = createConfigEditor('json', '', shape)
    expect(editor.serialize()).toBe('[]\n')
  })

  it('refuses an object root when the shape is an entry list', () => {
    expect(() => createConfigEditor('json', '{"provider":{}}', shape)).toThrow(ConfigParseError)
  })

  it('appends a whole entry when the id is not present yet', () => {
    const editor = createConfigEditor('json', '', shape)

    const before = editor.setObject('osw', { name: 'osw', vendor: 'customendpoint' })

    expect(before).toBeNull()
    expect(JSON.parse(editor.serialize())).toEqual([{ name: 'osw', vendor: 'customendpoint' }])
  })

  it('rewrites just the matching entry and leaves its neighbours untouched', () => {
    const text = '[\n  {\n    "name": "anthropic",\n    "apiKey": "keep-me"\n  },\n  {\n    "name": "osw",\n    "apiKey": "old"\n  }\n]\n'
    const editor = createConfigEditor('json', text, shape)

    const before = editor.setObject('osw', { name: 'osw', apiKey: 'sk-new' })

    expect(before).toContain('"apiKey": "old"')
    const serialized = editor.serialize()
    // 别的 provider 一个字节都不能动——这正是「只动目标键」在这层形状下的含义。
    expect(serialized).toContain('"name": "anthropic"')
    expect(serialized).toContain('"apiKey": "keep-me"')
    expect(JSON.parse(serialized)).toEqual([
      { name: 'anthropic', apiKey: 'keep-me' },
      { name: 'osw', apiKey: 'sk-new' },
    ])
  })

  it('writes a scalar into an existing entry', () => {
    const editor = createConfigEditor('json', '[{"name":"osw","apiKey":"old"}]', shape)

    const before = editor.set('osw.apiKey', 'sk-new')

    expect(before).toBe('old')
    expect(JSON.parse(editor.serialize())).toEqual([{ name: 'osw', apiKey: 'sk-new' }])
  })

  it('appends an entry that carries the id when only a nested scalar is set', () => {
    const editor = createConfigEditor('json', '[{"name":"other"}]', shape)

    editor.set('osw.apiKey', 'sk-1')

    // 新条目必须带上 id 字段，否则下次读的时候按 `name` 找不到它。
    expect(JSON.parse(editor.serialize())).toEqual([{ name: 'other' }, { name: 'osw', apiKey: 'sk-1' }])
  })

  it('keeps the file compact when the original was compact', () => {
    const editor = createConfigEditor('json', '[{"name":"osw"}]', shape)

    editor.setObject('osw', { name: 'osw', vendor: 'customendpoint' })

    expect(editor.serialize()).toBe('[{"name":"osw","vendor":"customendpoint"}]')
  })
})

describe('env editor', () => {
  const text = '# loaded by the CLI\nOSW_BASE_URL=https://example.com\nexport OSW_API_KEY="sk-1"\n'

  it('reads plain, exported and quoted values', () => {
    const editor = createConfigEditor('env', text)

    expect(editor.get('OSW_BASE_URL')).toBe('https://example.com')
    expect(editor.get('OSW_API_KEY')).toBe('sk-1')
    expect(editor.get('MISSING')).toBeNull()
  })

  it('replaces the matching line without disturbing the rest', () => {
    const editor = createConfigEditor('env', text)

    editor.set('OSW_API_KEY', 'sk-2')

    expect(editor.serialize()).toBe('# loaded by the CLI\nOSW_BASE_URL=https://example.com\nOSW_API_KEY=sk-2\n')
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

  it('starts a blank file with a single line', () => {
    const editor = createConfigEditor('env', '\n  \n')

    editor.set('OSW_BASE_URL', 'https://example.com')

    // 空文件里没有「原有内容」可言，不需要那个分隔空行。
    expect(editor.serialize()).toBe('OSW_BASE_URL=https://example.com\n')
  })

  it('rewrites an exported line and keeps the other lines untouched', () => {
    const editor = createConfigEditor('env', 'export OSW_API_KEY=sk-1\nOTHER=1\n')

    const before = editor.set('OSW_API_KEY', 'sk-2')

    // `export` 只是行的前缀；我们只替换命中的那一行，其余行原样交还。
    expect(before).toBe('sk-1')
    expect(editor.serialize()).toBe('OSW_API_KEY=sk-2\nOTHER=1\n')
  })

  it('quotes values that would otherwise be split or expanded by the shell', () => {
    const editor = createConfigEditor('env', 'A=1\n')

    editor.set('HASH', 'a#b')
    editor.set('QUOTE', 'say "hi"')
    editor.set('DOLLAR', '$HOME/x')
    editor.set('BACKSLASH', 'a\\ b')
    editor.set('PLAIN', 'https://example.com')

    const serialized = editor.serialize()
    expect(serialized).toContain('HASH="a#b"')
    // 引号在引号里要转义，否则写出来的值从 `say "hi"` 变成 `say "`。
    expect(serialized).toContain('QUOTE="say \\"hi\\""')
    // `$` 与 `#` 不引就会被 shell 展开或当成注释。
    expect(serialized).toContain('DOLLAR="$HOME/x"')
    expect(serialized).toContain('BACKSLASH="a\\\\ b"')
    // 普通地址不加引号：多一个引号就多一个用户要读的字符。
    expect(serialized).toContain('PLAIN=https://example.com')
  })

  it('handles a file whose last line has no newline', () => {
    // 手工编辑出来的 `.env` 常常末行不带换行符：读得到、改得动，我们补上换行。
    const editor = createConfigEditor('env', 'A=1')

    expect(editor.get('A')).toBe('1')

    const before = editor.set('A', '2')

    expect(before).toBe('1')
    expect(editor.serialize()).toBe('A=2\n')
  })

  it('does not add a second blank line when the file already ends with one', () => {
    const editor = createConfigEditor('env', 'A=1\n\n')

    editor.set('B', '2')

    expect(editor.serialize()).toBe('A=1\n\nB=2\n')
  })

  it('keeps one blank line between the old content and a batch of new keys', () => {
    const editor = createConfigEditor('env', 'A=1\n')

    editor.set('B', '2')
    editor.set('C', '3')

    // 同一批追加出来的键之间不插空行：它们是「新加的那一段」，不是两段。
    expect(editor.serialize()).toBe('A=1\n\nB=2\nC=3\n')
  })

  it('writes a non-string scalar as its text form', () => {
    const editor = createConfigEditor('env', '')

    editor.set('OSW_DEBUG', true)

    expect(editor.serialize()).toBe('OSW_DEBUG=true\n')
  })

  it('reads a single-quoted value as well as a double-quoted one', () => {
    const editor = createConfigEditor('env', "A='raw #1'\n")

    expect(editor.get('A')).toBe('raw #1')
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

  it('merges the template keys into an existing table, keeping the user\'s own rows', () => {
    const text = [
      '[model_providers.openai]',
      'name = "OpenAI"',
      'base_url = "https://api.openai.com/v1"',
      '# 我们不改的：公司网关要的 header',
      'http_headers = { "X-Team" = "infra" }',
      '',
    ].join('\n')
    const editor = createConfigEditor('toml', text)

    const before = editor.setObject('model_providers.openai', { name: 'One Switch' })

    const serialized = editor.serialize()
    expect(serialized).toContain('name = "One Switch"')
    // 用户自己加的键、注释、空行留在原处：我们只换模板声明的那几个键。
    expect(serialized).toContain('base_url = "https://api.openai.com/v1"')
    expect(serialized).toContain('# 我们不改的：公司网关要的 header')
    expect(serialized).toContain('http_headers = { "X-Team" = "infra" }')
    // 「改前」是整张表体的原文，版本摘要因此能说出「原来是这些键」。
    expect(before).toContain('name = "OpenAI"')
  })

  it('appends a template key the table does not have yet', () => {
    const editor = createConfigEditor('toml', '[model_providers.osw]\nname = "One Switch"\n')

    editor.setObject('model_providers.osw', { name: 'One Switch', base_url: 'http://127.0.0.1:9300' })

    expect(editor.serialize()).toBe('[model_providers.osw]\nname = "One Switch"\nbase_url = "http://127.0.0.1:9300"\n')
  })

  it('refuses a table value that is not a scalar', () => {
    const editor = createConfigEditor('toml', text)
    expect(() => editor.setObject('model_providers.osw', { name: 'One Switch', models: { a: {} } })).toThrow(ConfigParseError)
  })

  it('refuses a non-string entry when merging into an existing table', () => {
    const editor = createConfigEditor('toml', '[model_providers.osw]\nname = "One Switch"\n')

    expect(() => editor.setObject('model_providers.osw', { name: 'One Switch', models: { a: {} } })).toThrow(ConfigParseError)
    // 拦在写之前：那张表还在，且一个字没改。
    expect(editor.serialize()).toBe('[model_providers.osw]\nname = "One Switch"\n')
  })

  it('adds a key to an existing section', () => {
    const editor = createConfigEditor('toml', '[model_providers.osw]\nname = "One Switch"\n\n[other]\nk = "v"\n')

    const before = editor.set('model_providers.osw.wire_api', 'responses')

    // 新键落在**这张表的末尾**，不能越到下一个表头后面去。
    expect(before).toBeNull()
    expect(editor.serialize()).toBe('[model_providers.osw]\nname = "One Switch"\nwire_api = "responses"\n\n[other]\nk = "v"\n')
  })

  it('starts the section it was asked to write into when the file has none', () => {
    const editor = createConfigEditor('toml', 'model = "gpt-5"\n')

    editor.set('model_providers.osw.name', 'One Switch')

    // 表不存在时先把表头立起来：直接拼一行会把 `name` 写成根键，落进别人的表里。
    expect(editor.serialize()).toBe('model = "gpt-5"\n\n[model_providers.osw]\nname = "One Switch"\n')
  })

  it('leaves a later table untouched when it writes into an earlier one', () => {
    const editor = createConfigEditor('toml', '[model_providers.osw]\nname = "One Switch"\n\n[model_providers.other]\nname = "Other"\nbase_url = "https://example.com"\n')

    editor.setObject('model_providers.osw', { name: 'One Switch', base_url: 'http://127.0.0.1:9300' })

    // `findSectionEnd` 必须停在下一个表头：越过它就会把键写进别人的表。
    expect(editor.serialize()).toBe(
      '[model_providers.osw]\nname = "One Switch"\nbase_url = "http://127.0.0.1:9300"\n\n[model_providers.other]\nname = "Other"\nbase_url = "https://example.com"\n',
    )
  })

  it('reads single-quoted, empty, boolean and numeric scalars as text', () => {
    const editor = createConfigEditor('toml', ['literal = \'raw #1\'', 'empty =', 'flag = true', 'count = 30', ''].join('\n'))

    // 单引号是 TOML 的「不做转义」写法，去掉引号就是值；其余形态原样交回文本。
    expect(editor.get('literal')).toBe('raw #1')
    expect(editor.get('flag')).toBe('true')
    expect(editor.get('count')).toBe('30')
    // 只写了键没写值：没有值可读，不是空字符串。
    expect(editor.get('empty')).toBeNull()
  })

  it('unescapes a double-quoted value', () => {
    const editor = createConfigEditor('toml', 'path = "C:\\\\logs\\""\n')

    expect(editor.get('path')).toBe('C:\\logs"')
  })

  it('does not read an inline table as a value', () => {
    const editor = createConfigEditor('toml', 'headers = { "X-Team" = "infra" }\n')

    // 与数组同一道判断：读不出来就是「没有值」，不当成字符串回显。
    expect(editor.get('headers')).toBeNull()
  })

  it('reads a table header that carries a trailing comment', () => {
    const editor = createConfigEditor('toml', '[model_providers.osw] # 本机服务\nname = "One Switch"\n')

    expect(editor.get('model_providers.osw.name')).toBe('One Switch')
    // 表头后面跟注释也是同一张表；认不出来就会新开一张同名的表。
    editor.set('model_providers.osw.wire_api', 'responses')
    expect(editor.serialize()).toBe('[model_providers.osw] # 本机服务\nname = "One Switch"\nwire_api = "responses"\n')
  })

  it('does not treat a commented-out header as a table', () => {
    const editor = createConfigEditor('toml', '# [model_providers.osw]\nmodel = "gpt-5"\n')

    expect(editor.get('model_providers.osw.name')).toBeNull()
    // 注释不是表，写进去不能把那张废表当成真的：只能新开一张。
    editor.set('model_providers.osw.name', 'One Switch')
    expect(editor.serialize()).toBe('# [model_providers.osw]\nmodel = "gpt-5"\n\n[model_providers.osw]\nname = "One Switch"\n')
  })

  it('treats an array-of-tables header as its own section', () => {
    const editor = createConfigEditor('toml', ['[[mcp_servers]]', 'name = "one"', '', '[[mcp_servers]]', 'name = "two"', ''].join('\n'))

    // 同名的表可能出现多次；`findSectionStart` 只认第一个，改的就是第一张，第二张原样留着。
    editor.set('mcp_servers.name', 'renamed')

    expect(editor.serialize()).toBe(['[[mcp_servers]]', 'name = "renamed"', '', '[[mcp_servers]]', 'name = "two"', ''].join('\n'))
  })

  it('keeps the blank line the user left above the first table', () => {
    const editor = createConfigEditor('toml', 'model = "gpt-5"\n\n[other]\nk = "v"\n')

    editor.set('model_provider', 'osw')

    // 根级键插在表头**上方**，但用户自己排的那道空行还是空的、还在原来的位置。
    expect(editor.serialize()).toBe('model = "gpt-5"\nmodel_provider = "osw"\n\n[other]\nk = "v"\n')
  })

  it('appends a missing root key after the last root line', () => {
    const editor = createConfigEditor('toml', 'model = "gpt-5"\n# 备注\n')

    const before = editor.set('model_provider', 'osw')

    // 文件里没有表：新键接在最后一行内容之后，注释行留在原地。
    expect(before).toBeNull()
    expect(editor.serialize()).toBe('model = "gpt-5"\n# 备注\nmodel_provider = "osw"\n')
  })

  it('writes a non-string scalar as its text form', () => {
    const editor = createConfigEditor('toml', 'flag = true\ncount = 30\n')

    // 我们的键都是字符串；拿到布尔或数字时按文本写，不做类型猜测。
    editor.set('flag', false)
    editor.set('count', 60)

    expect(editor.serialize()).toBe('flag = "false"\ncount = "60"\n')
  })

  it('starts an empty file with the key itself', () => {
    const editor = createConfigEditor('toml', '')

    editor.set('model', 'osw/gpt-5')

    // 空文件里没有「原文的空行」这回事：我们写出第一行，就不该在它前面留一道空白。
    expect(editor.serialize()).toBe('model = "osw/gpt-5"\n')
  })

  it('writes the first table into a blank file without a leading blank line', () => {
    const editor = createConfigEditor('toml', '\n\n')

    editor.setObject('model_providers.osw', { name: 'One Switch' })

    // 与上一题同一个道理：只有空白等于什么都没有，表头就是文件的第一行。
    expect(editor.serialize()).toBe('[model_providers.osw]\nname = "One Switch"\n')
  })

  it('creates the table a dotted path needs in a blank file', () => {
    const editor = createConfigEditor('toml', '')

    editor.set('model_providers.osw.name', 'One Switch')

    expect(editor.serialize()).toBe('[model_providers.osw]\nname = "One Switch"\n')
  })
})

describe('yaml editor', () => {
  const patchList = { kind: 'patchList' } as const

  const text = [
    '# 我的 dsh 配置',
    '- id: agent-loop',
    '  config:',
    '    model: deepseek-v4 # 主模型',
    '- id: llm-deepseek',
    '  config:',
    '    baseURL: https://api.deepseek.com',
    '    apiKey: sk-1',
    '    temperature: 0.7',
    '',
  ].join('\n')

  it('reads a scalar inside an id-addressed entry, skipping the payload nesting', () => {
    const editor = createConfigEditor('yaml', text, patchList)

    // 逻辑路径只写到载荷里的那个键：`config` 这一段是存储形状，由编辑器补齐，不写在声明里。
    expect(editor.get('llm-deepseek.baseURL')).toBe('https://api.deepseek.com')
    expect(editor.get('llm-deepseek.apiKey')).toBe('sk-1')
    expect(editor.get('agent-loop.model')).toBe('deepseek-v4')
  })

  it('does not read an entry the document does not have', () => {
    const editor = createConfigEditor('yaml', text, patchList)

    expect(editor.get('missing.key')).toBeNull()
    expect(editor.get('llm-deepseek.missing')).toBeNull()
  })

  it('replaces a scalar in place, keeping comments and every other line', () => {
    const editor = createConfigEditor('yaml', text, patchList)

    const before = editor.set('llm-deepseek.baseURL', 'http://127.0.0.1:9300')

    expect(before).toBe('https://api.deepseek.com')
    // 只动目标值那一处：文件头注释、行尾注释、缩进、键顺序全部原样。
    expect(editor.serialize()).toBe(text.replace('https://api.deepseek.com', 'http://127.0.0.1:9300'))
  })

  it('zeroes in on the last entry when the same id appears twice', () => {
    const duplicated = ['- id: llm-deepseek', '  config:', '    baseURL: https://a', '- id: llm-deepseek', '  config:', '    baseURL: https://b'].join('\n')
    const editor = createConfigEditor('yaml', duplicated, patchList)

    // 与工具自己一致：同名条目以最后一条为准，改的也是它。
    expect(editor.get('llm-deepseek.baseURL')).toBe('https://b')
    editor.set('llm-deepseek.baseURL', 'http://127.0.0.1:9300')
    expect(editor.serialize()).toContain('baseURL: https://a')
    expect(editor.serialize()).toContain('baseURL: http://127.0.0.1:9300')
  })

  it('appends a new entry when the id is not there yet', () => {
    const editor = createConfigEditor('yaml', text, patchList)

    editor.set('api-gateway.model', 'osw/gpt-5')

    const serialized = editor.serialize()
    expect(serialized).toContain('- id: api-gateway')
    expect(serialized).toContain('  config:\n    model: osw/gpt-5')
    // 追加不碰旧内容：原来的条目与注释都还在。
    expect(serialized).toContain('# 我的 dsh 配置')
    expect(serialized).toContain('baseURL: https://api.deepseek.com')
  })

  it('creates the payload mapping when an entry exists without one', () => {
    const editor = createConfigEditor('yaml', ['- id: agent-loop', '- id: llm-deepseek'].join('\n'), patchList)

    editor.set('agent-loop.model', 'osw/gpt-5')

    expect(editor.serialize()).toBe('- id: agent-loop\n  config:\n    model: osw/gpt-5\n- id: llm-deepseek\n')
  })

  it('starts a fresh patch list in an empty document', () => {
    const editor = createConfigEditor('yaml', '', patchList)

    editor.set('llm-deepseek.apiKey', 'sk-osw')

    expect(editor.serialize()).toBe('- id: llm-deepseek\n  config:\n    apiKey: sk-osw\n')
  })

  it('writes a value the scalar type calls for, not a quoted string', () => {
    const editor = createConfigEditor('yaml', text, patchList)

    editor.set('llm-deepseek.temperature', 1)
    editor.set('llm-deepseek.enabled', true)

    // 数字就是数字、布尔就是布尔（YAML 里 `"true"` 与 `true` 是两回事）；字符串才带引号。
    expect(editor.serialize()).toContain('temperature: 1')
    expect(editor.serialize()).toContain('enabled: true')
  })

  it('quotes a numeric string so it is not read back as a number', () => {
    const editor = createConfigEditor('yaml', text, patchList)

    editor.set('llm-deepseek.temperature', '1')

    // 字符串 `"1"` 与数字 `1` 在 YAML 里不是一回事：写出去的字面必须还能读回字符串。
    expect(editor.serialize()).toContain('temperature: "1"')
    expect(editor.get('llm-deepseek.temperature')).toBe('1')
  })

  it('does not need the shape declared at all for a plain nested mapping', () => {
    // 缺省形状就是嵌套映射：不给 shape 也能读写一条点号路径。
    const editor = createConfigEditor('yaml', 'model: gpt-5\nnested:\n  key: value\n')

    expect(editor.get('nested.key')).toBe('value')
    editor.set('nested.key', 'other')
    expect(editor.serialize()).toBe('model: gpt-5\nnested:\n  key: other\n')
  })

  it('creates missing intermediate mappings for a plain nested mapping', () => {
    const editor = createConfigEditor('yaml', 'model: gpt-5\n')

    editor.set('provider.osw.name', 'One Switch')

    expect(editor.serialize()).toBe('model: gpt-5\nprovider:\n  osw:\n    name: One Switch\n')
  })

  it('writes a whole object into an entry payload', () => {
    const editor = createConfigEditor('yaml', text, patchList)

    editor.setObject('llm-deepseek.models', { 'gpt-5': {}, 'gpt-4': {} })

    const serialized = editor.serialize()
    expect(serialized).toContain('    models:\n      gpt-5: {}\n      gpt-4: {}')
    // 表的其它键原样留着。
    expect(serialized).toContain('baseURL: https://api.deepseek.com')
  })

  it('refuses to write into a document that is not a list of entries', () => {
    // 一份把顶层写成映射的文件不是 dsh 的补丁列表；读不到、也绝不把用户的结构盖掉。
    const editor = createConfigEditor('yaml', 'model: gpt-5\n', patchList)

    expect(editor.get('llm-deepseek.apiKey')).toBeNull()
    expect(() => editor.set('llm-deepseek.apiKey', 'sk-osw')).toThrow(ConfigParseError)
  })

  it('treats a broken document as unparsable instead of guessing', () => {
    expect(() => createConfigEditor('yaml', '- id: a\n  config:\n    x: [unclosed', patchList)).toThrow(ConfigParseError)
  })

  it('keeps a placeholder path unreadable, like the other editors', () => {
    const editor = createConfigEditor('yaml', text, patchList)

    // `<id>` 是「运行期才知道的一段」，读的时候没有具体 id，只能当读不到。
    expect(editor.get('<id>.baseURL')).toBeNull()
  })
})
