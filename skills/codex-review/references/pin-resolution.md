# Pin resolution

The `adopt` capability resolves the latest reviewed action release at invocation time unless the integrator supplies a reviewed SHA/tag pair. No static pin table is shipped with the skill. The skill stays stateless across releases and the default resolved pin tracks what the integrator's `gh` CLI sees as the latest stable tag.

## Contract

```bash
TAG=$(gh api repos/milanhorvatovic/codex-ai-code-review-action/releases/latest --jq '.tag_name')
SHA=$(gh api repos/milanhorvatovic/codex-ai-code-review-action/commits/"$TAG" --jq '.sha')
```

The capability emits the resolved `<TAG>` (e.g. `v2.1.0`) as the trailing `# v<X.Y.Z>` comment on every `uses:` line and the resolved `<SHA>` (40 hex chars, lowercase) as the pin.

Offline/pre-resolved runs may pass the same values directly with `--pin-sha <SHA> --pin-tag <TAG>`. Both values are required together. The SHA must be 40 lowercase hex characters and the tag must match `vX.Y.Z` so generated workflow comments and version-gated invariants remain auditable.

## Failure modes the capability must handle

- **`gh` not on PATH or not authenticated.** Exit non-zero with a remediation message pointing at `gh auth status`. Do not fall back to a stale value.
- **API call returns a non-2xx status.** Treat as fatal; surface the response body verbatim.
- **`releases/latest` returns a pre-release tag.** GitHub's `releases/latest` already excludes pre-releases by default. If the response somehow includes a `-rc.N` / `-beta.N` / `-alpha.N` / `-pre.N` / `-next.N` suffix, refuse to use it; pre-release SHAs must not be the default for `adopt` output.
- **The resolved SHA is not 40 hex characters.** Refuse and surface the malformed value.

## Why runtime, not static

The adoption flow needs one default fact: "what is the latest reviewed pin right now?" Maintaining a committed pin table inside the skill would couple the skill to the action's release cadence and add release-state maintenance to the companion artifact. Resolving at invocation keeps the skill stateless while the manual pin flags cover locked-down environments that already approved a SHA.
