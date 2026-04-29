## Summary

<!-- 1-3 bullets on what changed and why. -->

## Trust boundary impact

<!--
  Does this PR change any of the following? If yes, label the PR `trust-boundary`
  and describe the impact below. If no, leave "None." and delete this comment.

  - outbound HTTP destination
  - data sent to OpenAI
  - telemetry / logging that leaves the runner
  - permissions required by the action
  - artifact contents
  - transitive dependency SHA that changes any of the above

  See CONTRIBUTING.md → Trust-boundary changes for the full criteria.
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
