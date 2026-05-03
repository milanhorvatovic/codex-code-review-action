# Pin resolution

Both capabilities resolve the latest reviewed action release at invocation time. No static pin table is shipped, no `scripts/refresh-self-pins.ts` extension is required, and no `verify-doc-pins` row is added.

## Contract

```bash
TAG=$(gh api repos/milanhorvatovic/codex-ai-code-review-action/releases/latest --jq '.tag_name')
SHA=$(gh api repos/milanhorvatovic/codex-ai-code-review-action/commits/"$TAG" --jq '.sha')
```

The capability emits the resolved `<TAG>` (e.g. `v2.1.0`) as the trailing `# v<X.Y.Z>` comment on every `uses:` line and the resolved `<SHA>` (40 hex chars, lowercase) as the pin.

## Failure modes the capability must handle

- **`gh` not on PATH or not authenticated.** Exit non-zero with a remediation message pointing at `gh auth status`. Do not fall back to a stale value.
- **API call returns a non-2xx status.** Treat as fatal; surface the response body verbatim.
- **`releases/latest` returns a pre-release tag.** GitHub's `releases/latest` already excludes pre-releases by default. If the response somehow includes a `-rc.N` suffix, refuse to use it; pre-release SHAs must not be the default for `adopt` output.
- **The resolved SHA is not 40 hex characters.** Refuse and surface the malformed value.

## Why runtime, not static

The skill's two consumers (`adopt` and `tune`) need exactly one fact: "what is the latest reviewed pin right now?" Maintaining a committed pin table would couple the skill to the action's release cadence and add a verifier the existing `scripts/refresh-self-pins.ts` already covers for `README.md` and `.github/workflows/codex-review.yaml`. Resolving at invocation keeps the skill stateless and lets a follow-up `upgrade` capability compare two SHAs against `gh api` directly without a pre-baked history.
