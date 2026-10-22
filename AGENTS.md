<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Commit messages are written in English

The format is `type(scope): summary` with an imperative, single-line summary. **Write the subject and the body in English — never in Chinese.** Release notes are generated from commit subjects verbatim (`apps/app/scripts/release-notes.mjs`) and are always published in English, so a Chinese commit turns every release page into a half-Chinese, half-English read.

Chinese stays in the explanatory documents written for people: `apps/docs/specs/`, the READMEs and code comments. Commit messages are not one of those — they are a record that gets parsed by a script and compared line by line in diffs.

The authoritative wording lives in `apps/docs/specs/overview/tech-architecture.md` under 「提交信息」, which also lists the allowed types and how to rewrite history safely.
