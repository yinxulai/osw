import type { LiveActivity } from '@/data/live-activity'

interface ActivityPulseProps {
  /** 为空表示没有进行中的活动；组件不渲染任何占位内容。 */
  activity: LiveActivity | null
}

/** 事件到达时扩散一次的状态圆点；持续状态仍由调用方的实心圆点表达。 */
export function ActivityPulse(props: ActivityPulseProps) {
  if (props.activity === null) return null

  return (
    <span
      key={props.activity.key}
      data-slot="activity-pulse"
      data-activity-tone={props.activity.tone}
      aria-hidden
      className="status-event-pulse absolute size-1.5 rounded-full bg-current opacity-60"
    />
  )
}
