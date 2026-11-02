import { Skeleton } from '@/components/ui/skeleton'

/*
 * 首屏骨架的尺寸是照着详情页那几块的真身量的，不是随手给个方块。
 *
 * 骨架一旦比真身矮，内容到位的那一帧整页就会往下跳——「加载完成」本该是最安静的一瞬间。
 * 所以行数直接问注册表（结果在静态表里，不必等服务端）；只有正文编辑器要等文件到手才知道多高，
 * 那里就取一个常见配置的落点（见下方的 `SKELETON_EDITOR_HEIGHT`）。
 */
const SKELETON_CHROME_PLAIN = 67 // 卡片头（只有标题）49 + 18：可自动改写的客户端，`要写入的模型` 那张卡没有描述
const SKELETON_ROW_HEIGHT = 56
/** 内容模块的标签条：32px 标签 + 上方 12px（`pt-3`）。 */
const SKELETON_FILE_TABS_HEIGHT = 44
// 正文编辑器随着文件长度长，本来就没有标准高度，取一份十几行配置的落点——差几十像素看不出来，
// 但按最小高度（`min-h-72`）摆的话，真实内容一到手整页就要往下跳一大截。
const SKELETON_EDITOR_HEIGHT = 460

interface ClientDetailSkeletonProps {
  /** 多文件客户端的内容模块才摆标签条。 */
  fileTabs: boolean
  /** 「要写入的模型」有几行，由配方决定；0 表示这个客户端没有那一块，骨架也不能多摆一块。 */
  slots: number
}

/** 客户端详情首屏骨架：模型卡 + 内容编辑器。 */
export function ClientDetailSkeleton(props: ClientDetailSkeletonProps) {
  const { fileTabs, slots } = props

  // 返回 Fragment 而不是包一层 div：它们本来就该是 `PageContent` 网格的直接子项，间距才和真身一致。
  return (
    <>
      {slots > 0 && (
        <Skeleton
          className="w-full rounded-xl"
          style={{ height: SKELETON_CHROME_PLAIN + slots * SKELETON_ROW_HEIGHT }}
        />
      )}
      {/* 内容模块是一张卡：标签条（多文件才有）+ 正文。 */}
      <Skeleton
        className="w-full rounded-xl"
        style={{ height: SKELETON_EDITOR_HEIGHT + (fileTabs ? SKELETON_FILE_TABS_HEIGHT : 0) }}
      />
    </>
  )
}
