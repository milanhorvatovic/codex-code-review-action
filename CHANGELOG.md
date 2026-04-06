# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-04-06

### Changed

- **Breaking:** Replaced direct OpenAI API calls with [`openai/codex-action`](https://github.com/openai/codex-action) for reviews
- **Breaking:** Renamed `review` sub-action to `prepare` — it now builds diffs, splits chunks, and writes prompt files instead of calling the API
- **Breaking:** Architecture changed from 2-job (review → publish) to 3-job (prepare → review matrix → publish) workflow
- Chunk reviews now run in parallel via GitHub Actions matrix strategy (resolves #20)
- Publish action now handles chunk merging, retain-findings artifact upload, and exposes `findings-count` and `verdict` outputs
- Model defaults are handled by the Codex CLI — no more 400 errors when `model` is omitted (fixes #24)
- Removed `openai` npm dependency

### Removed

- `review` sub-action (replaced by `prepare`)
- `openai-api-key` action input (now passed directly to `openai/codex-action` in the review job)
- `src/openai/client.ts` (direct OpenAI API integration)

## [1.0.4] - 2026-04-06

### Fixed

- Action runtime updated from `node22` to `node24` — `node22` is not supported by GitHub Actions runners
- Node version aligned to 24.14.1 across build target, CI workflows, and local tooling

## [1.0.3] - 2026-04-06

### Changed

- Repository renamed from `codex-code-review-action` to `codex-ai-code-review-action`
- All internal references updated to match the new repository name

## [1.0.2] - 2026-04-06

### Changed

- Root action renamed from "Codex Review" to "Codex AI Code Review" for Marketplace URL

## [1.0.1] - 2026-04-06

### Fixed

- Root action description shortened to meet GitHub Marketplace 125-character limit

## [1.0.0] - 2026-04-06

### Added

- Two-action architecture with security isolation: read-only `review` job and write-access `publish` job
- OpenAI Codex integration with structured JSON output via the Responses API
- Diff chunking at file boundaries with configurable `max-chunk-bytes`
- Multi-chunk review merging with deduplication of findings, files, and changes
- Inline PR comments on changed lines with automatic diff-line mapping
- Configurable confidence threshold (`min-confidence`) and comment cap (`max-comments`)
- User allowlist to restrict which PR authors trigger reviews
- Custom review reference file support for per-repository review rules
- Prompt injection defences (backtick neutralisation, dynamic fencing, untrusted-data labelling)
- Long-lived artifact upload for audit/analytics via `retain-findings`
- Per-file summary and overall correctness verdict in PR review body
- Automatic truncation to GitHub API limits (65K body, 65K inline comment)
- Fallback to body-only review when inline comment posting fails
- CodeQL security scanning workflow
- Dependabot configuration with auto-merge for patch/minor updates
- CI pipeline with linting, type checking, test coverage, and dist verification
- Security policy (`.github/SECURITY.md`)
- Package metadata (`author`, `repository`, `bugs`, `homepage`) in `package.json`
- Root composite `action.yaml` for GitHub Marketplace listing
- Automated release process via tag-triggered workflow
