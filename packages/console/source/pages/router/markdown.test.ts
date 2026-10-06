// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderNoteMarkdown } from './markdown'

describe('renderNoteMarkdown', () => {
  it('空文本返回空串，由调用方决定空状态怎么画', () => {
    expect(renderNoteMarkdown('')).toBe('')
    expect(renderNoteMarkdown('   \n  ')).toBe('')
  })

  it('正常渲染 Markdown 结构', () => {
    expect(renderNoteMarkdown('**粗**')).toBe('<p><strong>粗</strong></p>\n')
    expect(renderNoteMarkdown('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n')
  })

  // Markdown 允许内联 HTML，所以渲染结果必须过一遍白名单：
  // 一段随手粘贴的内容不能变成可执行脚本。
  it('脚本与内联事件被清掉', () => {
    const html = renderNoteMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  // 链接与图片被过滤掉：节点本身要响应点击和拖拽，里面再挂一个可点元素会同时触发两个动作；
  // 备注也不该在渲染时去请求远端图片。链接的文字会留下，图片则是整块消失
  //（`img` 没有内容，DOMPurify 拿掉标签后什么都不剩），这也是它可以被接受的原因。
  it('链接去标签保文字，图片整块去掉', () => {
    expect(renderNoteMarkdown('[官网](https://example.com)')).toBe('<p>官网</p>\n')
    expect(renderNoteMarkdown('前 ![图](https://example.com/a.png) 后')).toBe('<p>前  后</p>\n')
  })
})
