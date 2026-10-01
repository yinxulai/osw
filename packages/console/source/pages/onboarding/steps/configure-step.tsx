import { AddressCard } from '@/components/address-card'
import { InterfaceTableCard } from '@/components/interface-table-card'
import { useAccessConfig } from '@/hooks/use-access-config'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { ClientConfigEditor } from '@/pages/client-config/components/client-config-editor'

/**
 * 第二步：接工具。
 *
 * 三块内容，各自只回答一个问题：客户端该指向哪条地址（地址卡）、怎么就地改客户端配置（配置编辑器）、
 * 哪些路径会被受理（接口表）。
 *
 * 这里**不摆服务状态带**（运行中 / 监听在哪 / 兼容地址说明 / 去改端口）：那些是「服务本身」的事，
 * 前面已经成立、也随时能在逻辑模型页与托盘菜单里看和改，摆在「怎么填」这一步只多一层噪音。
 * 这一步要回答的只有一件事——把地址填到哪、怎么填。
 *
 * 地址卡只是一条地址：它下面是**配置编辑器**，而不是「哪些客户端不用手抄」「每次写入都留版本」
 * 这类说明——那些话要么多余（编辑器就在下面），要么属于编辑器内部的事，不必在卡片里先讲一遍。
 * 想逐行看全局状态与版本历史的人，去客户端配置页（导航里就有），不在这里再摆一个跳转入口。
 *
 * 接口表排在最后：它是**受理面**，回答的是「接上没接上」而不是「怎么接」，
 * 属于收尾而不是前面任何一步的前提。它和客户端配置页共用同一张卡，且都摊开——一张参考卡
 * 摆出「点一下才能看」只会白多一步。
 *
 * 版面是**单调的一列**：地址卡 → 配置编辑器 → 接口表。
 * 引导是一步一步往下读的，顺序就是读的顺序，不摆左右布局——新手在这一步只需要照着往下走。
 * 与客户端配置页共用的是**内容与组件**（同样的地址、同样的编辑器、同样的接口清单），不是版面。
 */
export function ConfigureStep() {
  const config = useAccessConfig()
  const { copiedKey, copy } = useCopyToClipboard()

  return (
    <div className="space-y-4">
      <AddressCard
        origin={config.origin}
        copiedKey={copiedKey}
        onCopy={copy}
      />
      {/*
        就地改配置：与客户端配置页共用同一套编辑器（同样的状态、同样的正文），
        只是这里多了一层「选哪个客户端」。引导里改完，正式页面里已经是生效的结果。
      */}
      <ClientConfigEditor />
      <InterfaceTableCard />
    </div>
  )
}
