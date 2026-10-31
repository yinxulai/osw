import { describe, expect, it } from 'vitest'
import { prettyRequestBody, requestBodyDownload, requestBodyFileName } from './request-body-download'

describe('prettyRequestBody', () => {
  it('JSON 重排成两格缩进，内容一字不改', () => {
    expect(prettyRequestBody('{"a":1,"b":[2]}')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}')
  })

  it('非 JSON 原样返回', () => {
    expect(prettyRequestBody('data: {"a":1}\n\n')).toBe('data: {"a":1}\n\n')
    expect(prettyRequestBody('plain text')).toBe('plain text')
  })

  it('坏掉的 JSON 原样返回，不吞内容', () => {
    expect(prettyRequestBody('{"a":')).toBe('{"a":')
  })
})

describe('requestBodyFileName', () => {
  it('带上方法与请求 ID', () => {
    expect(requestBodyFileName('req_abc123', 'post')).toBe('POST-req_abc123.json')
  })

  it('路径分隔符之类的字符换掉，避免落成一个非法文件名', () => {
    expect(requestBodyFileName('a/b:c*?"<>|d', 'GET')).toBe('GET-a-b-c-d.json')
  })

  it('两者都空时仍有可用文件名', () => {
    expect(requestBodyFileName('', '')).toBe('REQ-request.json')
  })
})

describe('requestBodyDownload', () => {
  it('有正文时给出文件名与内容', () => {
    const file = requestBodyDownload({ requestId: 'req_1', method: 'POST', body: '{"a":1}' })
    expect(file?.name).toBe('POST-req_1.json')
    expect(file?.text).toBe('{\n  "a": 1\n}')
  })

  it('正文为 null 或空串时没有可下载的东西', () => {
    expect(requestBodyDownload({ requestId: 'req_1', method: 'POST', body: null })).toBeNull()
    expect(requestBodyDownload({ requestId: 'req_1', method: 'POST', body: '' })).toBeNull()
  })
})
