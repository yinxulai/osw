import type { Protocol } from '@common/schemas'
import type { HttpRouter } from '@server/http-router'

export function registerAnthropicMessagesRoutes(router: HttpRouter<Protocol>): void {
  router.post('/v1/messages', 'anthropic-messages')
  router.post('/messages', 'anthropic-messages')
}
