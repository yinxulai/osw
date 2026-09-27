import type { LiveActivity } from '@/data/live-activity'

interface LogicalModelActivityOverlayProps {
  activity: LiveActivity | null
}

/** 覆盖卡片边框的有限事件高光；静态忙碌底边由卡片的 `logical-model-card-busy` 提供。 */
export function LogicalModelActivityOverlay(props: LogicalModelActivityOverlayProps) {
  if (props.activity === null) return null

  return (
    <span
      key={props.activity.key}
      data-slot="logical-model-activity-overlay"
      data-activity-tone={props.activity.tone}
      aria-hidden
      className="logical-model-card-event"
    />
  )
}
