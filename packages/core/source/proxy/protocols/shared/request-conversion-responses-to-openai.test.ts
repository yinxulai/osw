import { describe, expect, it } from 'vitest'
import { responsesToOpenAiRequest } from './request-conversion-responses-to-openai'
import { ToolNameRegistry } from './tool-name-registry'

/** 降级后的 custom 工具：单字符串参数 `input` 的 function，描述里补一句 JSON 转义说明。 */
function downgradedCustomTool(name: string, description?: string): unknown {
  return {
    type: 'function',
    function: {
      name,
      description: [
        description,
        'This tool takes free-form text. Put its complete input in the `input` string field, JSON-escaped.',
      ].filter(Boolean).join('\n\n'),
      parameters: {
        type: 'object',
        properties: { input: { type: 'string', description: 'The complete input for this tool as free-form text.' } },
        required: ['input'],
      },
    },
  }
}

describe('responsesToOpenAiRequest', () => {
  it('converts instructions, text, images, and request options', () => {
    const result = responsesToOpenAiRequest({
      instructions: 'Be concise',
      input: [
        'plain input',
        { role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
        { role: 'user', content: [{ type: 'input_image', image_url: { url: 'https://example.com/a.png' } }] },
      ],
      max_output_tokens: 512,
      temperature: 0.4,
      top_p: 0.7,
      stream: true,
      prompt_cache_key: 'cache-key',
      prompt_cache_retention: '24h',
    }, 'upstream-model')

    expect(result).toEqual({
      model: 'upstream-model',
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'plain input' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] },
      ],
      max_tokens: 512,
      temperature: 0.4,
      top_p: 0.7,
      stream: true,
      prompt_cache_key: 'cache-key',
      prompt_cache_retention: '24h',
    })
  })

  it('converts function calls and outputs and skips invalid input', () => {
    const result = responsesToOpenAiRequest({
      input: [
        null,
        { role: 'assistant', content: [{ type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' }] },
        { role: 'user', content: [{ type: 'function_call_output', call_id: 'call_1', output: 'found' }] },
      ],
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'found' },
      ],
    })
  })

  it('converts top-level function call items and merges consecutive calls', () => {
    const result = responsesToOpenAiRequest({
      input: [
        { type: 'function_call', call_id: 'call_1', name: 'a', arguments: '{"x":1}' },
        { type: 'function_call', call_id: 'call_2', name: 'b' },
        { type: 'function_call_output', call_id: 'call_1', output: 'one' },
        { type: 'function_call_output', call_id: 'call_2', output: [{ type: 'output_text', text: 'two' }] },
      ],
    }, 'model')

    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'a', arguments: '{"x":1}' } },
          { id: 'call_2', type: 'function', function: { name: 'b', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'one' },
      { role: 'tool', tool_call_id: 'call_2', content: 'two' },
    ])
  })

  it('accepts string input and drops reasoning and reference items', () => {
    expect(responsesToOpenAiRequest({ input: 'hello' }, 'm').messages).toEqual([{ role: 'user', content: 'hello' }])

    const result = responsesToOpenAiRequest({
      input: [
        { type: 'reasoning', summary: [] },
        { type: 'item_reference', id: 'msg_1' },
        { role: 'developer', content: 'dev' },
      ],
    }, 'm')

    expect(result.messages).toEqual([{ role: 'system', content: 'dev' }])
  })

  it('flushes buffered text before nested tool items to keep order', () => {
    const result = responsesToOpenAiRequest({
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'here' },
            { type: 'function_call_output', call_id: 'call_1', output: 'done' },
          ],
        },
      ],
    }, 'm')

    expect(result.messages).toEqual([
      { role: 'user', content: 'here' },
      { role: 'tool', tool_call_id: 'call_1', content: 'done' },
    ])
  })

  it('maps tools, tool choice, text format, reasoning effort, and passthrough fields', () => {
    const result = responsesToOpenAiRequest({
      input: 'hi',
      tools: [
        { type: 'function', name: 'lookup', description: 'Look up', parameters: { type: 'object' }, strict: true },
        // 非 function 类型的内置工具在 Chat Completions 中没有对应能力
        { type: 'web_search' },
      ],
      tool_choice: { type: 'function', name: 'lookup' },
      text: { format: { type: 'json_schema', name: 'answer', schema: { type: 'object' }, strict: true, description: 'desc' } },
      reasoning: { effort: 'high' },
      parallel_tool_calls: false,
      metadata: { trace: 't' },
      user: 'user-1',
      prompt_cache_options: { mode: 'implicit' },
      prompt_cache_key: 'key',
      prompt_cache_retention: '24h',
    }, 'model')

    expect(result).toMatchObject({
      model: 'model',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'Look up', parameters: { type: 'object' }, strict: true } }],
      tool_choice: { type: 'function', function: { name: 'lookup' } },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', schema: { type: 'object' }, strict: true, description: 'desc' },
      },
      reasoning_effort: 'high',
      parallel_tool_calls: false,
      metadata: { trace: 't' },
      user: 'user-1',
      prompt_cache_options: { mode: 'implicit' },
      prompt_cache_key: 'key',
      prompt_cache_retention: '24h',
    })
  })

  it('flattens namespace tool groups and registers the reverse mapping', () => {
    const toolNames = new ToolNameRegistry()
    const result = responsesToOpenAiRequest({
      input: [
        { type: 'function_call', call_id: 'call_1', name: 'lookup', namespace: 'crm', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_1', namespace: 'crm', output: 'ok' },
      ],
      tools: [
        { type: 'namespace', name: 'crm', description: 'CRM tools', tools: [{ type: 'function', name: 'lookup', description: 'Look up' }] },
        { type: 'function', name: 'plain', parameters: { type: 'object' } },
      ],
    }, 'm', toolNames)

    expect(result.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'crm__lookup',
          // 命名空间描述拼进组内工具的描述：Chat 没有分组维度，不拼这段语义就丢了
          description: 'CRM tools\n\nLook up',
          parameters: { type: 'object', properties: {} },
        },
      },
      { type: 'function', function: { name: 'plain', description: '', parameters: { type: 'object' } } },
    ])
    // 历史里的 namespace 限定调用要换成模型看到过的展平名，`call_id` 关联不受影响
    expect(result.messages).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'crm__lookup', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    ])
    expect(toolNames.restore('crm__lookup')).toEqual({ namespace: 'crm', name: 'lookup' })
    // 顶层工具名原样保留，不在映射表里
    expect(toolNames.restore('plain')).toBeUndefined()
  })

  it('keeps namespace-qualified calls consistent with the flattened tool definitions', () => {
    const result = responsesToOpenAiRequest({
      input: [{ type: 'function_call', call_id: 'call_1', name: 'lookup', namespace: 'crm' }],
      tools: [{ type: 'namespace', name: 'crm', tools: [{ type: 'function', name: 'lookup' }] }],
    }, 'm')

    const messages = result.messages as Array<{ tool_calls: Array<{ function: { name: string } }> }>
    const tools = result.tools as Array<{ function: { name: string } }>
    expect(messages[0].tool_calls[0].function.name).toBe('crm__lookup')
    expect(tools[0].function.name).toBe('crm__lookup')
  })

  it('keeps same-named tools from different namespaces apart', () => {
    const result = responsesToOpenAiRequest({
      input: 'hi',
      tools: [
        { type: 'namespace', name: 'crm', tools: [{ type: 'function', name: 'lookup' }] },
        { type: 'namespace', name: 'billing', tools: [{ type: 'function', name: 'lookup' }] },
      ],
    }, 'm')

    expect(result.tools).toEqual([
      { type: 'function', function: { name: 'crm__lookup', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'billing__lookup', description: '', parameters: { type: 'object', properties: {} } } },
    ])
  })

  it('lets a top-level tool name win over an identical flattened name', () => {
    const result = responsesToOpenAiRequest({
      input: 'hi',
      tools: [
        // 顶层工具名必须原样保留，因此展平结果让位
        { type: 'function', name: 'crm__lookup', parameters: { type: 'object' } },
        { type: 'namespace', name: 'crm', tools: [{ type: 'function', name: 'lookup' }] },
      ],
    }, 'm')

    expect((result.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name))
      .toEqual(['crm__lookup', 'crm__lookup__2'])
  })

  it('keeps custom members of a namespace and skips malformed groups', () => {
    const result = responsesToOpenAiRequest({
      input: 'hi',
      tools: [
        { type: 'namespace', tools: [{ type: 'function', name: 'orphan' }] },
        { type: 'namespace', name: 'crm', tools: [null, { type: 'custom', name: 'raw' }, { type: 'function' }] },
      ],
    }, 'm')

    // 无名的命名空间整组跳过；组内无名成员各自丢弃，custom 成员保留并展平
    expect(result.tools).toEqual([downgradedCustomTool('crm__raw')])
  })

  it('degrades custom tools to single-string function tools', () => {
    const result = responsesToOpenAiRequest({
      input: 'hi',
      tools: [
        { type: 'custom', name: 'raw', description: 'Raw input', format: { type: 'grammar', definition: 'start: WORD', syntax: 'lark' } },
        { type: 'custom', name: 'plain', format: { type: 'text' } },
      ],
    }, 'm')

    // Chat 规范里有 `CustomTool`，但多数兼容供应商只实现 function，会整份请求拒掉；
    // 因此统一降级。`format` 没有承载处，随之丢弃，并在描述里补一句说明输入必须是 JSON 字符串。
    expect(result.tools).toEqual([
      downgradedCustomTool('raw', 'Raw input'),
      downgradedCustomTool('plain'),
    ])
  })

  it('registers degraded custom tools so the response side can restore them', () => {
    const toolNames = new ToolNameRegistry()
    responsesToOpenAiRequest({
      input: 'hi',
      tools: [
        { type: 'namespace', name: 'crm', tools: [{ type: 'custom', name: 'raw' }] },
        { type: 'custom', name: 'plain' },
      ],
    }, 'm', toolNames)

    expect(toolNames.isCustomTool('crm__raw')).toBe(true)
    expect(toolNames.isCustomTool('plain')).toBe(true)
    expect(toolNames.isCustomTool('function')).toBe(false)
  })

  it('maps custom tool calls and outputs in both top-level and nested input', () => {
    const toolNames = new ToolNameRegistry()
    const result = responsesToOpenAiRequest({
      input: [
        { type: 'custom_tool_call', call_id: 'call_1', name: 'lookup', namespace: 'crm', input: 'raw text' },
        { type: 'custom_tool_call_output', call_id: 'call_1', output: 'ok' },
        { role: 'user', content: [
          { type: 'custom_tool_call', call_id: 'call_2', name: 'raw', input: 'x' },
          { type: 'custom_tool_call_output', call_id: 'call_2', output: 'done' },
        ] },
      ],
      tools: [
        { type: 'namespace', name: 'crm', tools: [{ type: 'custom', name: 'lookup' }] },
        { type: 'custom', name: 'raw' },
      ],
    }, 'm', toolNames)

    expect(result.tools).toEqual([
      downgradedCustomTool('crm__lookup'),
      downgradedCustomTool('raw'),
    ])
    // 历史调用与工具定义同形态：function + `{"input": "..."}`
    expect(result.messages).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'crm__lookup', arguments: '{"input":"raw text"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'raw', arguments: '{"input":"x"}' } }] },
      { role: 'tool', tool_call_id: 'call_2', content: 'done' },
    ])
  })

  it('drops custom tool calls without a name', () => {
    const result = responsesToOpenAiRequest({
      input: [{ type: 'custom_tool_call', call_id: 'call_1', input: 'x' }],
    }, 'm')

    expect(result.messages).toEqual([])
  })

  it('maps every tool choice variant and simple text format', () => {
    const choiceOf = (choice: unknown): unknown => responsesToOpenAiRequest({ input: 'hi', tool_choice: choice }, 'm').tool_choice

    expect(choiceOf('auto')).toBe('auto')
    expect(choiceOf('none')).toBe('none')
    expect(choiceOf('required')).toBe('required')
    expect(choiceOf({ type: 'function', name: 'lookup' })).toEqual({ type: 'function', function: { name: 'lookup' } })
    // custom 工具已降级成 function，强制选择必须跟着改形态
    expect(choiceOf({ type: 'custom', name: 'raw' })).toEqual({ type: 'function', function: { name: 'raw' } })
    expect(choiceOf({ type: 'function' })).toBeUndefined()
    // 允许集合在 Chat 里不存在，只保留强制语义
    expect(choiceOf({ type: 'allowed_tools', mode: 'required', tools: [{ type: 'function', name: 'lookup' }] })).toBe('required')
    expect(choiceOf({ type: 'allowed_tools', mode: 'auto' })).toBe('auto')
    // 强制内置工具所对应的工具本身也已被丢弃，不臆造替代值
    expect(choiceOf({ type: 'mcp', server_label: 'deepwiki' })).toBeUndefined()
    expect(choiceOf({ type: 'web_search_preview' })).toBeUndefined()
    expect(choiceOf('bogus')).toBeUndefined()
    expect(responsesToOpenAiRequest({ input: 'hi' }, 'm')).not.toHaveProperty('tool_choice')

    const jsonObject = responsesToOpenAiRequest({ input: 'hi', text: { format: { type: 'json_object' } } }, 'm')
    expect(jsonObject.response_format).toEqual({ type: 'json_object' })
  })

  it('rewrites tool choice to the flattened name the upstream actually sees', () => {
    const choiceOf = (choice: unknown): unknown => responsesToOpenAiRequest({
      input: 'hi',
      tools: [{ type: 'namespace', name: 'crm', tools: [{ type: 'function', name: 'lookup' }, { type: 'custom', name: 'raw' }] }],
      tool_choice: choice,
    }, 'm').tool_choice

    // 客户端写的是它自己声明的名字，上游只认展平名，否则会报「未知工具」
    expect(choiceOf({ type: 'function', name: 'lookup' })).toEqual({ type: 'function', function: { name: 'crm__lookup' } })
    expect(choiceOf({ type: 'custom', name: 'raw' })).toEqual({ type: 'function', function: { name: 'crm__raw' } })

    const topLevel = responsesToOpenAiRequest({
      input: 'hi',
      tools: [{ type: 'function', name: 'plain' }],
      tool_choice: { type: 'function', name: 'plain' },
    }, 'm')
    expect(topLevel.tool_choice).toEqual({ type: 'function', function: { name: 'plain' } })
  })

  it('leaves tool choice untouched when the name is ambiguous', () => {
    const result = responsesToOpenAiRequest({
      input: 'hi',
      tools: [
        { type: 'namespace', name: 'crm', tools: [{ type: 'function', name: 'lookup' }] },
        { type: 'namespace', name: 'billing', tools: [{ type: 'function', name: 'lookup' }] },
      ],
      tool_choice: { type: 'function', name: 'lookup' },
    }, 'm')

    // 两个命名空间里的同名工具只从 `name` 无法消歧，宁可让上游报错也不猜错工具
    expect(result.tool_choice).toEqual({ type: 'function', function: { name: 'lookup' } })
  })

  it('carries input_image detail only when Chat Completions supports the value', () => {
    const imageContentOf = (part: Record<string, unknown>): unknown => {
      const messages = responsesToOpenAiRequest({ input: [{ role: 'user', content: [part] }] }, 'm').messages as Array<Record<string, unknown>>
      return messages[0].content
    }

    expect(imageContentOf({ type: 'input_image', image_url: 'https://example.com/a.png', detail: 'high' }))
      .toEqual([{ type: 'image_url', image_url: { url: 'https://example.com/a.png', detail: 'high' } }])
    expect(imageContentOf({ type: 'input_image', image_url: 'https://example.com/a.png', detail: 'auto' }))
      .toEqual([{ type: 'image_url', image_url: { url: 'https://example.com/a.png', detail: 'auto' } }])
    // Responses 多出来的 `original`（以及非法值）在 Chat Completions 没有对应取值，只保留 url
    expect(imageContentOf({ type: 'input_image', image_url: 'https://example.com/a.png', detail: 'original' }))
      .toEqual([{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }])
    expect(imageContentOf({ type: 'input_image', image_url: 'https://example.com/a.png', detail: 1 }))
      .toEqual([{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }])
  })

  it('joins array-style function call output and serializes non-text output', () => {
    // Responses 文档里 `function_call_output.output` 是 `string or array`，图片/文件项没有文本时按空串跳过
    const result = responsesToOpenAiRequest({
      input: [
        { type: 'function_call_output', call_id: 'call_1', output: [
          { type: 'input_text', text: 'line one' },
          { type: 'input_image', image_url: 'https://example.com/a.png' },
          { type: 'input_text', text: 'line two' },
        ] },
        { type: 'function_call_output', call_id: 'call_2', output: { nested: true } },
        { type: 'function_call_output', call_id: 'call_3', output: null },
      ],
    }, 'm')

    expect(result.messages).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: 'line one\nline two' },
      { role: 'tool', tool_call_id: 'call_2', content: '{"nested":true}' },
      { role: 'tool', tool_call_id: 'call_3', content: '' },
    ])
  })

  it('defaults a json schema format without an inline schema and drops non-boolean strict', () => {
    const schemaless = responsesToOpenAiRequest({ input: 'hi', text: { format: { type: 'json_schema', name: 'answer' } } }, 'm')
    expect(schemaless.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'answer', schema: {} } })

    const looseStrict = responsesToOpenAiRequest({
      input: 'hi',
      text: { format: { type: 'json_schema', name: 'answer', schema: { type: 'object' }, strict: 'yes' } },
    }, 'm')
    expect(looseStrict.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object' } } })
  })

  it('normalizes a json schema name the upstream would otherwise reject', () => {
    // 两侧对 `name` 的约束相同（`a-z A-Z 0-9 _ -`，最长 64），而响应不回显这个名字，
    // 所以这里归一化不会丢信息，只是让不合规的客户端也能用。
    const result = responsesToOpenAiRequest({
      input: 'hi',
      text: { format: { type: 'json_schema', name: 'my answer!', schema: { type: 'object' } } },
    }, 'm')
    expect(result.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'my_answer_', schema: { type: 'object' } } })

    const long = responsesToOpenAiRequest({
      input: 'hi',
      text: { format: { type: 'json_schema', name: 'x'.repeat(70), schema: {} } },
    }, 'm')
    expect(long.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'x'.repeat(64), schema: {} } })
  })

  it('tolerates malformed input items without throwing', () => {
    const result = responsesToOpenAiRequest({
      input: [
        null,
        42,
        { type: 'function_call' },
        'ok',
        { role: '' },
        { role: 'user', content: [] },
        { role: 'user', content: [{ type: 'input_audio', input_audio: {} }] },
      ],
      tools: 'nope',
      text: { format: { type: 'json_schema' } },
    }, 'model')

    expect(result).toEqual({ model: 'model', messages: [{ role: 'user', content: 'ok' }] })
  })
})
