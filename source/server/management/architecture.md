# Management Module Structure

## Current Shape

The module is now split into three layers:

1. `core/` for request boundary helpers, response writing, and cross-cutting guards
2. `routes/` for domain-oriented management APIs
3. `infrastructure/` for shared runtime helpers such as log buffering

That keeps the HTTP entry points small while preserving domain ownership in the route layer.

## Actual Layout

```text
source/server/management/
  architecture.md
  config/
    export-config.ts
    import-config.ts
    routes.ts
    schemas.ts
  core/
    environment-guard.ts
    error-handler.ts
    request-body.ts
    request-guards.ts
    response.ts
  infrastructure/
    log-buffer.ts
  router.ts
  routes/
    administration/
      index.ts
      runtime-control.ts
      settings.ts
    catalog/
      index.ts
      models.ts
      provider-models.ts
      providers.ts
    config/
      routes.ts
    diagnostics/
      index.ts
      model-test.ts
      provider-models-fetch.ts
    index.ts
    observability/
      index.ts
      analytics.ts
      logs.ts
      request-logs.ts
    relations/
      index.ts
      relations.ts
      request-rewrite-rules.ts
  server.ts
```

## Boundary Rules

- `server.ts` owns lifecycle and top-level request wiring.
- `router.ts` owns route composition and request dispatch.
- `core/` owns reusable request/response plumbing and guards.
- `routes/` is split by business domain, not by technical primitive.
- `infrastructure/` holds helpers that are shared but not HTTP-bound.
- Each domain folder exposes one `index.ts` entrypoint.

## Why This Shape

- It reduces the top-level file count without losing discoverability.
- It keeps route ownership close to the domain they serve.
- It makes future additions local: new management features should usually only touch one domain folder.
