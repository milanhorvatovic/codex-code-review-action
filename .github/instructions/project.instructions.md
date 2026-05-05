---
applyTo: "**/*"
---

# Project Context

This is a TypeScript GitHub Action for AI-powered code review that delegates the model call to [`openai/codex-action`](https://github.com/openai/codex-action).

## Architecture

- three-job design with security isolation:
  - **Prepare** (read-only): diff fetch, chunking at file boundaries, prompt assembly, embedded reference materials
  - **Review** (read-only, matrix per chunk): composite wrapper around `openai/codex-action` that runs each chunk's prompt and uploads the structured output as an artifact
  - **Publish** (write-access): merges chunk outputs, posts the PR review with inline comments and per-file summaries, exposes `findings-count` and `verdict`
- two JavaScript actions (`prepare`, `publish`) plus the composite `review/action.yaml` wrapping `openai/codex-action`. Only the JavaScript actions need bundling: each is bundled independently by `esbuild` and targets `node24`.
- The root `action.yaml` is a Marketplace placeholder and is intentionally non-functional — it errors out and directs callers to the `prepare` / `review` / `publish` sub-actions. Do not wire the three sub-actions into it; the design relies on consumers calling each sub-action explicitly so the read-only and write-access jobs stay isolated.
- Default prompt and reference files embedded at build time via esbuild text loader.

## Module Structure

```
src/
├── prepare/        # Prepare action entry point (diff fetch, chunking, prompt assembly)
├── publish/        # Publish action entry point (chunk merging, PR review posting)
├── core/           # Pure business logic (diff processing, prompt assembly, merging)
├── github/         # GitHub API interaction (PR context, review posting)
├── config/         # Configuration (types, inputs, embedded defaults)
└── types/          # TypeScript declarations (.md text imports)
```

The `review` action is a composite wrapper around `openai/codex-action` and has no `src/` subdirectory.

## Build and Validation

- Build: `npm run build`
- Type check: `npm run typecheck`
- Test: `npm test`
- Lint: `npm run lint`
- Coverage: `npm run test -- --coverage`

## Conventions

- Exact dependency versions in `package.json` (no caret or tilde ranges)
- `.yaml` extension for all YAML files
- Modular design: small, composable modules with clear boundaries
- Extract modules when it reduces complexity, not just to split files
- Keep coupling low and cohesion high
- Co-located tests (`*.test.ts` alongside source files)
- Pure functions in `src/core/` — no side effects or direct I/O
- Constructor injection for external dependencies (testability)

## Security Model

- Set minimal `permissions` in workflows (only what the job needs)
- Mask secrets with `core.setSecret()` before any logging
- Pass untrusted input via environment variables, never interpolate into shell commands
- Validate all external inputs at system boundaries
- Pin third-party actions to full commit SHA

## Pull request authoring

- PR descriptions follow [`.github/PULL_REQUEST_TEMPLATE.md`](../PULL_REQUEST_TEMPLATE.md): `## Summary`, `## Security-review impact`, `## Release label`, `## Test plan`.
- Fill every section. If the PR does not affect any trust-boundary or containment-mechanism surface, leave `None.` in the Security-review impact section rather than deleting the heading.
- Apply the `trust-boundary` label when the change touches a trust-boundary surface, the `security-review-required` label when it touches a containment-mechanism surface, or both when it touches both.
- See [`CONTRIBUTING.md` → Security-review-required changes](../../CONTRIBUTING.md#security-review-required-changes) for the criteria and the maintainer-side review process.
