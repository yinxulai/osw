import type { Protocol } from '@common/schemas'
import type { HttpRouter } from '@server/http-router'

export function registerOpenAiResponsesRoutes(router: HttpRouter<Protocol>): void {
  router.post('/v1/responses', 'openai-responses')
  router.post('/responses', 'openai-responses')
}
