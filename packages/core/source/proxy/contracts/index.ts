/**
 * 契约层：`contracts` 不依赖任何实现（不 import `node:http` 之外的运行时、
 * 不 import 具体协议、不 import 数据库）。所有实现都只依赖这里。
 *
 * 依赖方向：`protocols` / `transports` / `modifiers` / `observers` / `planners`
 * → `contracts`，反向不成立。
 */

export type { HeaderMap } from './headers'
export type { Frame, FrameSink, HeadFrame } from './frame'
export type { RouteMatcher, RouteMethod } from './route-matcher'
export type { ExecutionOrigin } from './execution'
export type { BodyDeliveryShape, ClientDelivery, ClientResponseHead, DeliveryDecision, DeliveryDecisionRef, StageShapeSupport } from './delivery'
export { bodyDeliveryShape, createDeliveryDecisionRef, isStageRunnable, stageShapeSupport } from './delivery'
export type { AttemptView, ExchangeView } from './exchange'
export type { Transport, TransportKind, UpstreamConnection, UpstreamTarget } from './transport'
export type { BufferedPayload, Modifier, ModifierContext, ModifierDirection, ModifierFrameMode, ModifierScope } from './modifier'
export type { AttemptPlanner, PlanExhaustedReason, PlannerInput, PlanResult } from './planner'
export type { EnvelopeInput, EnvelopeWriteResult, ProtocolBodyKind, ProtocolEndpointSpec, ProtocolEnvelope, ProtocolModelReadResult } from './protocol'
export type { AttemptOutcomeView, Observer } from './observer'
