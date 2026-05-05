## Summary

<!-- 1-3 bullets on what changed and why. -->

## Security-review impact

<!--
  Does this PR change any of the surfaces below? If yes, label the PR with the
  matching class (`trust-boundary`, `security-review-required`, or both) and
  describe the impact below. If no, leave "None." and delete this comment.

  Trust-boundary surfaces (what data crosses what boundary — label `trust-boundary`):
    - outbound HTTP destination
    - data sent to OpenAI
    - telemetry / logging that leaves the runner
    - permissions required by the action
    - artifact contents
    - default exit-code contract
    - transitive dependency SHA that changes any of the above

  Containment-mechanism surfaces (how those boundaries stay enforced — label `security-review-required`):
    - event trigger surface (especially adding/expanding `pull_request_target`)
    - secret scoping, passing, naming, or job exposure
    - model-execution sandboxing (e.g. `openai/codex-action` `sandbox:` input)
    - `review-reference-file` / `review-reference-source` validation, resolution, or sourcing
    - workflow job-boundary moves between `prepare` / `review` / `publish`

  See CONTRIBUTING.md → Security-review-required changes for the full criteria.
-->

None.

## Release label

<!--
  Apply exactly one of:

  - `release: major` — major version bump (breaking change)
  - `release: minor` — minor version bump (new feature)
  - `release: patch` — patch version bump (fix or documentation only)
  - `release: skip`  — excluded from the next release (chore, infra, internal-only, release-prep)

  The required check `verify-pr-release-label` enforces exactly one.
  Dependabot PRs auto-carry `release: patch`.
-->

## Test plan

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build` and the regenerated `dist/` is committed (drop this bullet only for docs-only or CI-config-only PRs that cannot change `dist/`)
