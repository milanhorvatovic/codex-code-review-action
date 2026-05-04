# Release gate

This page is the auditable rollup that decides whether a release tag is ready to be cut. It aggregates the validation, manual security checks, and sign-off discipline that every `v<X.Y.Z>` tag must satisfy before `release-on-merge.yaml` pushes the tag.

The CI pipeline already runs every check that can be automated. This gate is the maintainer-side rollup that catches the subset that is not — manual security regression checks, judgment-call waivers, and the sign-off record that ends up attached to the GitHub Release as evidence.

## How to use this gate

The gate applies to both release paths documented in [`CONTRIBUTING.md`](../CONTRIBUTING.md#release-process). Pick the working surface that matches the path you are using:

1. **Pick the working surface for the filled gate.**
   - **Automated path (default).** Open the release PR created by `prepare-release.yaml`, titled `release: v<X.Y.Z>`. Its body is composed by `scripts/prepare-release.ts` and already includes a sign-off checklist that points back at this page; the release PR description is the working surface.
   - **Manual path (fallback).** Create a local working copy of this page on the release branch (for example `release-gate-v<X.Y.Z>.md`) before merging the release commit. The local file is the working surface and ships in the evidence zip after tagging.
2. Walk this page top to bottom against the merge candidate (the release branch's HEAD before the squash-merge or before the local merge to `main`). Every pre-merge item must end up either checked off (with a verified-by line) or explicitly waived (with a rationale). The post-tag item under [Archiving the gate](#archiving-the-gate) is completed after `release.yaml` creates the GitHub Release.
3. Record the filled-in gate on the working surface picked in step 1 so the sign-off is visible before merging:
   - **Automated path:** in the release PR description, alongside the auto-generated header.
   - **Manual path:** in the local working copy held in the working tree (do not commit it to the release branch). The filled file is then packaged into the evidence zip in step 4 and uploaded as a release asset; the gate is intentionally not tracked in the repo so per-release artifacts do not accumulate. See [Archiving the gate](#archiving-the-gate).
4. After the tag pushes and the GitHub Release is created, package the filled gate plus any supporting evidence into a zip and upload it to the release as an asset. See [Archiving the gate](#archiving-the-gate).

The release PR body's checklist on the automated path is hard-coded in `buildPrBody` rather than generated from this document — when the gate's section structure changes, update both files in the same PR. On the manual path the maintainer copies this page directly, so the checklist always matches the doc.

## Required validation

Run the full validation suite against the merge candidate (the release branch's HEAD before the squash-merge), on the Node version pinned in `package.json` (`engines.node`). The release-tag automation (`release-on-merge.yaml`) re-validates the merge commit with `lint`, `typecheck`, tests, `verify-dist`, `verify-lockfile-version`, and the branch-vs-package-vs-CHANGELOG version-consistency check. `verify-doc-pins` and `verify-prose-style` run on every PR and push to `main` via their dedicated workflows but are not part of the release-tag job, so include them in this manual rerun to confirm the merge candidate's state. `npm audit` is maintainer-only and is the gate's advisory layer.

```bash
npm ci
npm run build
npm run lint
npm run typecheck
npm test
npm audit
npm run verify:doc-pins
npm run verify:prose-style
```

`npm audit` is advisory — a non-zero exit does not automatically block the tag, but every advisory must be triaged (fix, accept with documented rationale, or defer with a tracked issue) before sign-off. Capture the machine-readable form alongside the human-readable run for the evidence zip:

```bash
npm audit --json > audit.json
```

`audit.json` is the file referenced by [Archiving the gate](#archiving-the-gate) below.

## Dist reproducibility

The bundled `dist/` directory is committed to the repository so GitHub Actions can run the action without an install step. Confirm that `npm run build` against the merge candidate does not change any tracked artifact:

```bash
npm run build
git diff --exit-code -- dist package.json package-lock.json
```

A non-empty diff means the merge candidate ships a stale bundle or a `package.json` / `package-lock.json` that the build would rewrite. Both are tag blockers — fix the source PR before tagging.

## Manual security regression checks

These checks exercise the path-validation hardening landed in [`src/prepare/referenceFile.ts`](../src/prepare/referenceFile.ts) (PR [#98](https://github.com/milanhorvatovic/codex-ai-code-review-action/pull/98), closing issue [#89](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/89)) plus the prompt-artifact composition path. The unit suites in [`src/prepare/referenceFile.test.ts`](../src/prepare/referenceFile.test.ts) and [`src/prepare/main.test.ts`](../src/prepare/main.test.ts) cover them; running `npm test` against the merge candidate confirms the protections still bite. The cases are listed here as an audit checklist, not as a separate test harness.

- `review-reference-file: /proc/self/environ` is rejected with `must be workspace-relative, not absolute` before any read happens. The unit covers this in the `rejects an absolute POSIX path` case.
- `review-reference-file: ../outside.md` is rejected with `escapes the workspace` before any read happens. The unit covers this in the `rejects a path that escapes the workspace via '..'` case.
- A leaf path that is a symbolic link is rejected with `is a symbolic link; symlinks are not allowed`, and an ancestor directory symbolic link is rejected with `resolves through a symbolic link`. The unit covers both in the `rejects a leaf symbolic link` and `rejects an ancestor directory symbolic link` cases. Together these close the file-disclosure path against runner-local files (the same threat model `/proc/self/environ` exists to surface).
- Prompt artifacts produced by the `prepare` action against a benign reference file contain only the resolved (validated) reference content — no runner-local file contents leak in. The unit suite covers this path in [`src/prepare/main.test.ts`](../src/prepare/main.test.ts) (`uses the resolved custom reference content for each prompt`) by asserting that the assembled prompt receives the resolver's output, not the raw input. The dogfood workflow's prepare job uploads the assembled prompts as the `codex-prepare` artifact (path `.codex/`) before the review matrix consumes it; `retain-findings` does not affect this artifact (it controls the publish step's merged-review JSON only). Direct inspection has a constraint: [`allow-users` in `.github/workflows/codex-review.yaml`](../.github/workflows/codex-review.yaml) currently restricts the dogfood workflow to one account, so release-bot PRs are skipped (no artifact) and scratch PRs from any other maintainer are skipped too. If you are the allow-listed account, open a scratch PR against the merge candidate and download via `gh run download <run-id> --name codex-prepare` within the prepare job's retention window (1 day in the dogfood workflow). Other maintainers can either temporarily widen `allow-users` on a scratch branch to include their account or rely on the unit-test coverage above.

If any of the unit cases above are missing from the test suite or are skipped on the merge candidate, the gate fails — re-add coverage before tagging.

## Conditional base-mode checks

Run these only if the release contains the `review-reference-source: base` mode (tracked in issue [#97](https://github.com/milanhorvatovic/codex-ai-code-review-action/issues/97)). Until that lands, mark the section waived with a one-line rationale ("`review-reference-source: base` not part of v<X.Y.Z>; deferred to <next-version>") and move on.

- A PR that edits `.github/codex/review-reference.md` does not alter the policy applied to its own review when `review-reference-source: base` is set on the workflow. The base-mode read pulls the policy from the PR's base SHA, not the head SHA, so in-PR edits do not steer the prompt.
- A missing base-branch reference path fails fast with a clear diagnostic when `review-reference-source: base` is set. The error must name the missing path and the base SHA so a maintainer can identify whether the file was renamed, deleted, or never existed at the resolved base.

Both checks should be exercised in a scratch PR against the merge candidate before sign-off, and the result captured in the gate evidence zip.

## Release-specific items

Beyond the templated sections above, every release introduces a set of release-specific items the maintainer must verify against the merge candidate. Typical categories:

- Security or trust-boundary changes that need cross-referencing to the PR that landed them.
- Behavior or schema changes that need a manual check beyond what CI runs.
- Coordinated changes spanning several PRs whose individual reviews did not capture the cumulative effect.
- Post-tag automation outcomes (for example, the self-pin refresh PR opened by `release.yaml`) that need confirmation once the tag pushes and the follow-up PR lands.

For each release, populate the table below in the filled gate snapshot. The meta-issue tracking the release is the source for what should be on the list — the snapshot is the durable signed-off record. Cross-reference each item to the work that owns it (PR number, issue, or workflow file). Resolve every row to a `Verified by:` or `Waived:` line per the [Sign-off convention](#sign-off-convention).

| # | Item | Owning work | State |
|---|---|---|---|
| 1 | _short description of the release-specific item_ | _PR # / issue # / workflow file_ | _`Verified by: <maintainer> — <YYYY-MM-DD>` or `Waived: <rationale + tracked follow-up>`_ |

If a release introduces no items beyond the templated checks, record one row with `_None — release contains only routine maintenance._` and a verified-by line so the section is not left ambiguously empty.

## Sign-off convention

Every line in this gate ends in one of two states:

- **Verified by:** `<maintainer> — <YYYY-MM-DD>` — the maintainer ran the check against the merge candidate (pre-merge items) or against the published release (post-tag items) and confirms the expected behavior.
- **Waived:** `<rationale>` — the check does not apply to this release. The rationale must name the issue or PR that owns the deferred work and the target release for follow-up. A waiver without a tracked follow-up is not acceptable.

Acceptance bars:

- **Before tagging.** Every pre-merge gate item (Required validation, Dist reproducibility, Manual security regression checks, Conditional base-mode checks, Release-specific items, Trust-boundary cross-reference) is verified or waived; every waiver names its follow-up; the maintainer cutting the tag has signed off on the rollup.
- **After tagging.** The post-tag item ([Archiving the gate](#archiving-the-gate)) is verified once `release.yaml` has created the GitHub Release and the evidence zip has been uploaded. The release is not considered complete until this final item is signed off in the release PR thread or evidence record.

## Trust-boundary cross-reference

If the release contains any PR labeled `trust-boundary` that also contributes a release level (i.e. not `release: skip`), the CHANGELOG must include the dedicated `### ⚠️ Trust boundary change` callout per the [Release process / Trust-boundary changes](../CONTRIBUTING.md#trust-boundary-changes) rule in `CONTRIBUTING.md`. Skipped PRs do not appear in CHANGELOG entries, so a `trust-boundary` label on a `release: skip` PR (e.g. release-prep or internal infra) does not by itself trigger the callout requirement. The release PR's CHANGELOG diff is the source of truth — the gate does not re-list the trust-boundary policy here, only confirms it was applied.

## Archiving the gate

The filled-in gate plus supporting evidence ships as a zip asset on the GitHub Release page, not as a tracked file in the repository. This keeps the working tree free of one-shot per-release artifacts while preserving an immutable audit record next to the release tarball that is downloaded.

Recommended layout inside `release-gate-v<X.Y.Z>.zip`:

```text
release-gate-v<X.Y.Z>/
  gate.md             # this page filled in for v<X.Y.Z>, with verified-by / waived lines
  validation.log      # captured stdout/stderr from the Required validation block
  dist-diff.txt       # captured output from the Dist reproducibility command
  audit.json          # `npm audit --json` output, for traceable advisories
  manual-checks.md    # short notes on the manual security regression checks (and base-mode checks if applicable)
```

After the tag pushes, the GitHub Release exists (created by `release.yaml`), and every post-tag gate item — including any release-specific post-tag rows recorded under [Release-specific items](#release-specific-items) — has been signed off, upload the zip. For final releases the post-tag set includes waiting for the self-pin refresh PR to merge; for pre-releases (`vX.Y.Z-rc.N`) the refresh PR is intentionally skipped by `release.yaml`, so the gate proceeds as soon as the GitHub Release exists and any RC-specific post-tag items are signed off.

```bash
gh release upload v<X.Y.Z> release-gate-v<X.Y.Z>.zip --clobber
```

`--clobber` makes the upload retry-safe: a partial-upload retry, an evidence-zip regeneration, or a re-upload after a late post-tag verification all overwrite the existing asset instead of failing. Use this freedom — it is normal to upload a first cut as soon as the immediate post-tag items are confirmed, then re-upload with `--clobber` later when slower release-specific items resolve.

The zip is the durable record. If automation of this step proves useful after the first cycle, the upload can move into `release.yaml` — until then, it is a maintainer-driven step documented in the release process.
