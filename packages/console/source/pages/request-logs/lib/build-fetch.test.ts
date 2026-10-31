import { describe, expect, it } from 'vitest'
import { buildFetch } from './build-fetch'

describe('buildFetch', () => {
  it('拼出方法、地址、头与正文', () => {
    const code = buildFetch({
      url: 'http://127.0.0.1:9300/v1/chat/completions',
      method: 'post',
      headers: JSON.stringify({ 'content-type': 'application/json', accept: 'application/json' }),
      body: '{"model":"gpt-4o"}',
    })

    expect(code).toBe([
      'await fetch("http://127.0.0.1:9300/v1/chat/completions", {',
      '  method: "POST",',
      '  headers: {',
      '    "content-type": "application/json",',
      '    "accept": "application/json",',
      '  },',
      '  body: "{\\"model\\":\\"gpt-4o\\"}",',
      '})',
    ].join('\n'))
  })

  it('正文里的换行与引号转义成单个 JS 字面量', () => {
    const body = '{\n  "text": "it\'s a \\"test\\""\n}'
    const code = buildFetch({ url: 'http://x/y', method: 'POST', headers: null, body })

    // JSON.stringify 的产物本身是合法的 JS 字面量：换行变 \n，引号变 \"。
    expect(code).toContain(`body: ${JSON.stringify(body)},`)
    expect(code).not.toContain('\n  "text"')
  })

  it('多值头合成一个逗号分隔的字符串', () => {
    const code = buildFetch({
      url: 'http://x/y',
      method: 'GET',
      headers: JSON.stringify({ 'x-tag': ['a', 'b'] }),
      body: null,
    })

    expect(code).toContain('"x-tag": "a, b",')
  })

  it('丢掉浏览器会自己算（或被禁止）的头', () => {
    const code = buildFetch({
      url: 'http://x/y',
      method: 'POST',
      headers: JSON.stringify({ Host: 'x', 'Content-Length': '12', Connection: 'keep-alive', 'x-real': '1' }),
      body: 'abc',
    })

    expect(code).not.toContain('"Host"')
    expect(code).not.toContain('"Content-Length"')
    expect(code).not.toContain('"Connection"')
    expect(code).toContain('"x-real": "1",')
  })

  it('没有头也没有正文时不写这两个字段', () => {
    expect(buildFetch({ url: 'http://x/y', method: 'get', headers: 'not-json', body: '' }))
      .toBe('await fetch("http://x/y", {\n  method: "GET",\n})')
  })
})
