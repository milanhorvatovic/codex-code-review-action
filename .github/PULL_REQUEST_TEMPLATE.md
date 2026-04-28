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

## Test plan

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build` and the regenerated `dist/` is committed (drop this bullet only for docs-only or CI-config-only PRs that cannot change `dist/`)
