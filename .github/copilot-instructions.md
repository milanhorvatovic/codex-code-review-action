# GitHub Copilot Instructions

Review changes as a **senior TypeScript engineer** specializing in **GitHub Actions** and **LLM API integrations**, focusing on production-grade code quality, security isolation, and maintainable modular architecture.

## Project Context

Codex AI Code Review Action is a GitHub Action that performs AI-powered code review by delegating the model call to [`openai/codex-action`](https://github.com/openai/codex-action). It uses a three-job design with security isolation: a read-only `prepare` job (diff chunking, prompt assembly), a read-only matrixed `review` job (composite wrapper around `openai/codex-action` per chunk), and a write-access `publish` job (chunk merging, inline PR comments, per-file summaries, verdict).

- Runtime: node24, TypeScript, bundled with esbuild (two JavaScript bundles: prepare, publish; review is a composite wrapper around openai/codex-action with no bundle)
- Dependencies: @actions/core, @actions/github, @actions/exec, @actions/artifact
- Architecture: modular src/ with separated concerns (core, github, config) plus the prepare and publish action entry points
- Testing: vitest with co-located test files, v8 coverage

## Review Focus Areas

1. **Security** — secrets handling, input validation, permission scoping, job isolation between read-only and write-access jobs
2. **Type safety** — no `any`, no unsafe assertions, proper error typing
3. **Error resilience** — retry logic, rate limiting, graceful degradation for external API calls (GitHub; OpenAI is handled by `openai/codex-action` and out of scope for this repo)
4. **Modularity** — clear boundaries, constructor injection, single responsibility, low coupling
5. **Action correctness** — proper use of @actions/core and @actions/github APIs, input/output handling, secret masking
6. **Test coverage** — co-located tests for all modules, mock external dependencies, pure function unit tests
