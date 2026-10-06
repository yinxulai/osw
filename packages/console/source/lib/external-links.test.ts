import { describe, expect, it } from 'vitest'
import {
  DISCORD_URL,
  REPOSITORY_CONTRIBUTORS_URL,
  REPOSITORY_ISSUES_URL,
  REPOSITORY_RELEASES_URL,
  REPOSITORY_SLUG,
  REPOSITORY_URL,
} from './external-links'

/*
 * 这些地址会同时出现在设置页的「开发者」卡片、更新卡片的兜底跳转、贡献者头像墙等多处。
 * 用例盯的是「它们互相之间对得齐」——散成字面量之后最容易出的错就是某一处少了个斜杠、
 * 或者换成新仓库名时漏改一条。
 */

describe('仓库链接', () => {
  it('slug 是 owner/name 两段', () => {
    expect(REPOSITORY_SLUG.split('/')).toHaveLength(2)
  })

  it('主页由 slug 拼出，没有多余斜杠', () => {
    expect(REPOSITORY_URL).toBe(`https://github.com/${REPOSITORY_SLUG}`)
  })

  it('发布页用 /releases/latest 永久地址，仓库里不维护版本号', () => {
    expect(REPOSITORY_RELEASES_URL).toBe(`${REPOSITORY_URL}/releases/latest`)
  })

  it('贡献者榜与 issue 入口都挂在仓库主页下', () => {
    expect(REPOSITORY_CONTRIBUTORS_URL).toBe(`${REPOSITORY_URL}/graphs/contributors`)
    expect(REPOSITORY_ISSUES_URL).toBe(`${REPOSITORY_URL}/issues`)
  })
})

describe('社区链接', () => {
  it('Discord 邀请是 https 的完整链接', () => {
    expect(DISCORD_URL.startsWith('https://discord.gg/')).toBe(true)
  })
})
