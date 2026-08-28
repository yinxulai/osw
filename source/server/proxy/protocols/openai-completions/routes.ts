import type { Protocol } from '@common/schemas'
import type { HttpRouter } from '@server/http-router'

export function registerOpenAiCompletionsRoutes(router: HttpRouter<Protocol>): void {
  router.post('/v1/chat/completions', 'openai-completions')
  router.post('/chat/completions', 'openai-completions')
  router.post('/v1/completions', 'openai-completions')
  router.post('/completions', 'openai-completions')
  router.post('/v1/embeddings', 'openai-completions')
  router.post('/embeddings', 'openai-completions')
}
