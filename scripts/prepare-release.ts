import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bumpVersion,
  insertSection,
  isPrereleaseVersion,
  isRcOf,
  parseVersion,
  removeSections,
  type VersionBump,
} from "./changelog.js";

export type Label = { name: string };

export type PullRequest = {
  number: number;
  title: string;
  body: string;
  labels: Label[];
  url: string;
};

export const RELEASE_LEVEL_LABELS = [
  "release: major",
  "release: minor",
  "release: patch",
  "release: skip",
] as const;

export type ReleaseLevel = "major" | "minor" | "patch" | "skip";

const LABEL_TO_SECTION: Record<string, string> = {
  enhancement: "Added",
  bug: "Fixed",
  security: "Security",
  dependencies: "Dependencies",
  documentation: "Documentation",
  process: "Process",
};

export const SECTION_ORDER = [
  "Added",
  "Changed",
  "Fixed",
  "Security",
  "Dependencies",
  "Documentation",
  "Process",
  "⚠️ Trust boundary change",
] as const;

const TRUST_BOUNDARY_SECTION = "⚠️ Trust boundary change";
const TRUST_BOUNDARY_LABEL = "trust-boundary";

export function parseTargetVersion(input: string): string {
  return parseVersion(input);
}

export function releaseLevelOf(pr: PullRequest): ReleaseLevel {
  const levels: ReleaseLevel[] = [];
  for (const label of pr.labels) {
    switch (label.name) {
      case "release: major":
        levels.push("major");
        break;
      case "release: minor":
        levels.push("minor");
        break;
      case "release: patch":
        levels.push("patch");
        break;
      case "release: skip":
        levels.push("skip");
        break;
    }
  }
  const [first, ...rest] = levels;
  if (first === undefined) {
    throw new Error(
      `PR #${pr.number} (${pr.url}) is missing a release-level label (release: major|minor|patch|skip).`,
    );
  }
  if (rest.length > 0) {
    throw new Error(
      `PR #${pr.number} (${pr.url}) carries multiple release-level labels: ${levels.join(", ")}.`,
    );
  }
  return first;
}

const LEVEL_RANK: Record<Exclude<ReleaseLevel, "skip">, number> = {
  major: 3,
  minor: 2,
  patch: 1,
};

export function computeVersionBump(prs: PullRequest[]): VersionBump | "none" {
  let best: VersionBump | "none" = "none";
  for (const pr of prs) {
    const level = releaseLevelOf(pr);
    if (level === "skip") continue;
    if (best === "none") {
      best = level;
      continue;
    }
    if (LEVEL_RANK[level] > LEVEL_RANK[best]) {
      best = level;
    }
  }
  return best;
}

export function categorizePullRequest(pr: PullRequest): readonly string[] {
  const sections = new Set<string>();
  for (const label of pr.labels) {
    const section = LABEL_TO_SECTION[label.name];
    if (section !== undefined) sections.add(section);
  }
  if (sections.size === 0) sections.add("Changed");
  if (pr.labels.some((l) => l.name === TRUST_BOUNDARY_LABEL)) {
    sections.add(TRUST_BOUNDARY_SECTION);
  }
  return [...sections];
}

export function formatPullRequestEntry(pr: PullRequest): string {
  return `- ${pr.title} ([#${pr.number}](${pr.url}))`;
}

export function extractTrustBoundaryImpact(prBody: string): string {
  const headingMatch = /^## Trust boundary impact\s*$/m.exec(prBody);
  if (!headingMatch) {
    throw new Error(
      "Missing '## Trust boundary impact' heading. Trust-boundary PRs must include the section from .github/PULL_REQUEST_TEMPLATE.md.",
    );
  }
  const after = prBody.slice(headingMatch.index + headingMatch[0].length);
  const nextHeading = /^##\s/m.exec(after);
  const block = nextHeading ? after.slice(0, nextHeading.index) : after;
  let withoutComments = block;
  for (let prev = ""; prev !== withoutComments; ) {
    prev = withoutComments;
    withoutComments = withoutComments.replace(/<!--[\s\S]*?-->/g, "");
  }
  if (withoutComments.includes("<!--")) {
    throw new Error(
      "'## Trust boundary impact' section contains an unclosed HTML comment; fix the PR body.",
    );
  }
  const stripped = withoutComments
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
  if (stripped === "") {
    throw new Error(
      "'## Trust boundary impact' section is empty after stripping HTML comments.",
    );
  }
  if (stripped === "None." || stripped === "None") {
    throw new Error(
      "'## Trust boundary impact' section still contains the template default 'None.' for a trust-boundary-labeled PR.",
    );
  }
  return stripped;
}

type SectionEntries = {
  standard: Map<string, Map<number, string>>;
  trustBoundary: Map<number, string>;
};

function collectEntries(prs: PullRequest[]): SectionEntries {
  const standard = new Map<string, Map<number, string>>();
  const trustBoundary = new Map<number, string>();
  for (const pr of prs) {
    if (releaseLevelOf(pr) === "skip") continue;
    const sections = categorizePullRequest(pr);
    const entry = formatPullRequestEntry(pr);
    for (const section of sections) {
      if (section === TRUST_BOUNDARY_SECTION) {
        const impact = extractTrustBoundaryImpact(pr.body);
        trustBoundary.set(pr.number, `${entry} — ${impact}`);
      } else {
        let bucket = standard.get(section);
        if (bucket === undefined) {
          bucket = new Map();
          standard.set(section, bucket);
        }
        bucket.set(pr.number, entry);
      }
    }
  }
  return { standard, trustBoundary };
}

export function renderChangelogEntry(
  prs: PullRequest[],
  version: string,
  today: string,
): string {
  const { standard, trustBoundary } = collectEntries(prs);
  const lines: string[] = [`## [${version}] - ${today}`, ""];
  let appended = false;
  for (const section of SECTION_ORDER) {
    if (section === TRUST_BOUNDARY_SECTION) continue;
    const bucket = standard.get(section);
    if (bucket === undefined || bucket.size === 0) continue;
    const sorted = [...bucket.values()].sort((a, b) => a.localeCompare(b));
    lines.push(`### ${section}`, "");
    for (const entry of sorted) lines.push(entry);
    lines.push("");
    appended = true;
  }
  if (trustBoundary.size > 0) {
    const sorted = [...trustBoundary.values()].sort((a, b) => a.localeCompare(b));
    lines.push(`### ${TRUST_BOUNDARY_SECTION}`, "");
    for (const entry of sorted) lines.push(entry);
    lines.push("");
    appended = true;
  }
  if (!appended) {
    lines.push("_No notable changes._", "");
  }
  return lines.join("\n").replace(/\n+$/, "");
}

export function consolidateRcSections(changelog: string, finalVersion: string): string {
  return removeSections(changelog, (sectionVersion) =>
    isRcOf(sectionVersion, finalVersion),
  );
}

export function applyChangelogUpdate(
  changelog: string,
  version: string,
  today: string,
  prs: PullRequest[],
): string {
  const block = renderChangelogEntry(prs, version, today);
  const intermediate = isPrereleaseVersion(version)
    ? changelog
    : consolidateRcSections(changelog, version);
  return insertSection(intermediate, block);
}

export function bumpPackageJsonVersion(content: string, newVersion: string): string {
  parseVersion(newVersion);
  const trailing = content.endsWith("\n") ? "\n" : "";
  const parsed = JSON.parse(content) as Record<string, unknown>;
  if (!("version" in parsed)) {
    throw new Error("package.json has no 'version' field");
  }
  parsed.version = newVersion;
  return `${JSON.stringify(parsed, null, 2)}${trailing}`;
}

export function bumpPackageLockVersion(content: string, newVersion: string): string {
  parseVersion(newVersion);
  const trailing = content.endsWith("\n") ? "\n" : "";
  const parsed = JSON.parse(content) as Record<string, unknown>;
  if (!("version" in parsed)) {
    throw new Error("package-lock.json has no top-level 'version' field");
  }
  const packages = parsed.packages;
  if (typeof packages !== "object" || packages === null) {
    throw new Error("package-lock.json has no 'packages' object");
  }
  const rootPackage = (packages as Record<string, unknown>)[""];
  if (typeof rootPackage !== "object" || rootPackage === null) {
    throw new Error("package-lock.json has no 'packages[\"\"]' entry");
  }
  if (!("version" in (rootPackage as Record<string, unknown>))) {
    throw new Error("package-lock.json has no 'packages[\"\"].version' field");
  }
  parsed.version = newVersion;
  (rootPackage as Record<string, unknown>).version = newVersion;
  return `${JSON.stringify(parsed, null, 2)}${trailing}`;
}

export function selectLastNonPrereleaseTag(
  releases: Array<{ tagName: string; publishedAt: string; isPrerelease: boolean }>,
): { tagName: string; publishedAt: string } | undefined {
  for (const release of releases) {
    if (!release.isPrerelease) {
      return { tagName: release.tagName, publishedAt: release.publishedAt };
    }
  }
  return undefined;
}

export function resolveTargetVersion(args: {
  explicit: string | undefined;
  baseVersion: string;
  prs: PullRequest[];
  existingTags: ReadonlySet<string>;
}): string {
  const { explicit, baseVersion, prs, existingTags } = args;
  if (explicit !== undefined) {
    const parsed = parseTargetVersion(explicit);
    if (!isPrereleaseVersion(parsed) && existingTags.has(`v${parsed}`)) {
      throw new Error(
        `Tag v${parsed} already exists. Did you mean to cut v${bumpVersion(parsed, "patch")}?`,
      );
    }
    return parsed;
  }
  const bump = computeVersionBump(prs);
  if (bump === "none") {
    throw new Error(
      "All merged PRs since the last release are 'release: skip'; pass --version to force a bump.",
    );
  }
  if (isPrereleaseVersion(baseVersion)) {
    throw new Error(
      `Base version ${baseVersion} is a pre-release; pass --version explicitly so the bot does not skip the intended final cut.`,
    );
  }
  const targetVersion = bumpVersion(baseVersion, bump);
  if (existingTags.has(`v${targetVersion}`)) {
    throw new Error(
      `Computed next version v${targetVersion} already exists as a tag. Did you mean to cut v${bumpVersion(targetVersion, "patch")}, or pass an explicit --version?`,
    );
  }
  return targetVersion;
}

// Heuristic for "the maintainer has begun filling in the gate sign-off
// checklist". Returns true if any line in the body matches one of two
// signals after backtick-quoted spans are stripped:
//
//   1. A checked task-list row (`- [x] ...` or `- [X] ...`). The bot's
//      template only emits unchecked `- [ ]` boxes, so any checked row
//      indicates a maintainer flipped a box.
//   2. A line starting with `Verified by:` or `Waived:` (optionally preceded
//      by a list bullet and/or checkbox) followed by a non-placeholder
//      value (the `[^<\s]` look-ahead rejects the gate template's
//      `Verified by: <maintainer> — <YYYY-MM-DD>` example phrasing).
//
// Anchoring to line start avoids false positives from PR titles that happen
// to contain those labels mid-line. Stripping backticks avoids matches
// against the bot's instruction prose (which references the labels inside
// backticks). The two signals together cover both styles of maintainer
// progress: ticking checkboxes and writing explicit Verified-by /
// Waived lines.
//
// Used by `planPrBodyRefresh` to choose between (a) writing the full fresh
// template (when no maintainer fills exist, so reruns pick up checklist /
// template updates), (b) refreshing only the auto-header and preserving the
// sign-off section verbatim (the marker-present case), and (c) skipping the
// body edit entirely when fills exist but the marker is missing (defensive
// — the heading was renamed or sign-off was pasted into a legacy body, so
// surgical-merge would risk dropping fills).
const SIGNOFF_LINE_PATTERN =
  /^\s*(?:[-*]\s+\[[xX]\]\s+|(?:[-*]\s+(?:\[[ xX]\]\s+)?)?(?:Verified by|Waived):\s*[^<\s])/m;

export function existingBodyHasMaintainerSignoff(body: string | null | undefined): boolean {
  if (body === null || body === undefined || body === "") return false;
  // Scope detection to the sign-off section when the marker heading is
  // present. Above-marker text is bot-managed (auto-header / PR title list)
  // and any sign-off-shaped strings there are either bot template prose,
  // PR titles copied verbatim, or stray maintainer notes that the merge
  // path would not preserve anyway. Without this scoping, an above-marker
  // signal would route `planPrBodyRefresh` to merge mode and then get
  // silently dropped when the merge slices from the marker onward — losing
  // sign-off evidence.
  //
  // Inline-span stripping is intentionally line-bounded (`[^`\n]*` rather
  // than `[^`]*`) so an unmatched backtick — e.g. a PR title containing a
  // single backtick that the auto-header copies in verbatim — cannot swallow
  // an entire region of the body up to the next backtick. Without the
  // newline guard the regex could erase real `Verified by:` / `Waived:`
  // lines, making a signed-off body look untouched on rerun.
  const idx = findSignoffSectionStart(body);
  const target = idx >= 0 ? body.slice(idx) : body;
  const stripped = target
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  return SIGNOFF_LINE_PATTERN.test(stripped);
}

// Stable marker that delimits the auto-generated header from the gate
// sign-off section. `planPrBodyRefresh` splits the existing PR body at this
// heading so reruns can refresh the auto-header (PR list, since-line,
// pre-release flag) while preserving any maintainer-edited sign-off
// content below the heading.
//
// The split is line-anchored via `findSignoffSectionStart` rather than a
// plain substring search: the auto-header includes PR titles (PR-author
// controlled), and a title containing the literal heading text would
// otherwise be mistaken for the delimiter and corrupt the body on rerun.
export const SIGNOFF_SECTION_HEADER = "## Release gate sign-off";

const SIGNOFF_SECTION_HEADER_LINE_PATTERN = /^## Release gate sign-off$/m;

export function findSignoffSectionStart(body: string): number {
  const match = SIGNOFF_SECTION_HEADER_LINE_PATTERN.exec(body);
  return match ? match.index : -1;
}

export function buildAutoHeaderSection(args: {
  version: string;
  isPrerelease: boolean;
  prs: PullRequest[];
  baseTag: string | undefined;
}): string {
  const { version, isPrerelease, prs, baseTag } = args;
  const skipped = prs.filter((pr) => releaseLevelOf(pr) === "skip");
  const counted = prs.filter((pr) => releaseLevelOf(pr) !== "skip");
  const sinceLine =
    baseTag === undefined
      ? "Since repository inception."
      : `Since ${baseTag}.`;
  const lines: string[] = [
    `Release prepared by \`scripts/prepare-release.ts\` for v${version}.`,
    "",
    sinceLine,
    "",
    `**PRs included (${counted.length}):**`,
    ...(counted.length === 0
      ? ["", "_None._"]
      : ["", ...counted.map((pr) => `- #${pr.number} \`${releaseLevelOf(pr)}\` — ${pr.title}`)]),
    "",
    `**PRs excluded with \`release: skip\` (${skipped.length}):**`,
    ...(skipped.length === 0
      ? ["", "_None._"]
      : ["", ...skipped.map((pr) => `- #${pr.number} — ${pr.title}`)]),
    "",
    `**Pre-release:** ${isPrerelease ? "yes (major tag will not move; self-pin refresh skipped)" : "no"}`,
    "",
    "Merge this PR to trigger `release-on-merge.yaml`, which tags the merge commit and pushes the tag.",
  ];
  return lines.join("\n");
}

// Absolute URL for cross-references emitted into the release PR body.
// PR descriptions are rendered against the PR page URL, not against a
// repository file path, so relative links like `docs/release-gate.md` can
// resolve to a 404. The URL is host- and repository-aware, with three
// resolution layers:
//
// 1. `GITHUB_SERVER_URL` / `GITHUB_REPOSITORY` env vars (set by GitHub
//    Actions). Matches the existing pattern in `src/github/git.ts` and
//    `src/publish/main.ts`. Always preferred when present.
// 2. Optional git-remote fallback (host + repo parsed from
//    `git remote get-url origin`). Used by `runCli` so local manual runs
//    (`npm run prepare:release`) in forks or internal mirrors generate
//    links that point at the cloned repository, not the upstream.
// 3. Hard-coded upstream fallback (`https://github.com` + the canonical
//    upstream `owner/repo`) for environments that have neither.
//
// The branch in the URL path resolves through `branchOverride` (explicit
// caller pin) → git fallback (`origin/HEAD` resolved via
// `git symbolic-ref refs/remotes/origin/HEAD`) → hard-coded `main`. Note
// that `GITHUB_REF_NAME` is intentionally NOT consulted: under
// `workflow_dispatch` it carries the dispatch ref (e.g. `release/v2.1.0`
// when the workflow is rerun from the release branch), not the
// repository's default branch. Pinning the audit link to the dispatch ref
// would 404 after the branch is deleted post-merge — defeating the
// durable-audit-link goal documented in `docs/release-gate.md`. Forks and
// internal mirrors whose default branch is not `main` keep working as
// long as `origin/HEAD` is set on the clone or the caller passes
// `branchOverride`.
const DEFAULT_GATE_DOC_HOST = "https://github.com";
const DEFAULT_GATE_DOC_REPO = "milanhorvatovic/codex-ai-code-review-action";
const DEFAULT_GATE_DOC_BRANCH = "main";

export function resolveGateDocUrl(
  env: NodeJS.ProcessEnv = process.env,
  gitFallback?: { host: string; repo: string; defaultBranch?: string },
  branchOverride?: string,
): string {
  const host = env.GITHUB_SERVER_URL ?? gitFallback?.host ?? DEFAULT_GATE_DOC_HOST;
  const repo = env.GITHUB_REPOSITORY ?? gitFallback?.repo ?? DEFAULT_GATE_DOC_REPO;
  const branch =
    branchOverride ??
    gitFallback?.defaultBranch ??
    DEFAULT_GATE_DOC_BRANCH;
  return `${host}/${repo}/blob/${branch}/docs/release-gate.md`;
}

// Parses an `origin` remote URL into a `{ host, repo }` pair. Recognizes the
// three forms `git remote get-url` typically returns:
//   - scp-style SSH: `<user>@<host>:<owner>/<repo>(.git)?` — `<user>` is
//     conventionally `git` but can be any non-empty username (custom SSH
//     config aliases). Emitted as `https://<host>` because SSH remote URLs
//     do not carry an HTTP scheme.
//   - URL-style SSH: `ssh://[<user>@]<host>[:<port>]/<owner>/<repo>(.git)?`
//     — same emission rule as scp-style; the user, port, and any leading
//     slash on the path are stripped.
//   - HTTP(S): `https?://<host>/<owner>/<repo>(.git)?` — preserves the
//     matched scheme so internal mirrors using plain HTTP keep working.
// Returns null on any unrecognized form so callers can fall back cleanly.
export function parseGitRemoteUrl(
  remoteUrl: string,
): { host: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  if (trimmed === "") return null;
  const scp = /^[^@:/\s]+@([^:]+):(.+?)(?:\.git)?$/.exec(trimmed);
  if (scp) return { host: `https://${scp[1]}`, repo: scp[2] };
  const sshUrl = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/+(.+?)(?:\.git)?$/.exec(
    trimmed,
  );
  if (sshUrl) return { host: `https://${sshUrl[1]}`, repo: sshUrl[2] };
  const http = /^(https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
  if (http) return { host: `${http[1]}://${http[2]}`, repo: http[3] };
  return null;
}

// Stable HTML-comment marker embedded in the sign-off section so reruns can
// distinguish "this body was generated by the current bot template" from
// "this body was generated by an older bot template". Bump the version
// suffix whenever buildSignoffSection's content changes (lines added,
// removed, reworded, or links updated). The marker is invisible in
// rendered Markdown but byte-comparable.
//
// Used by `existingBodyHasMaintainerEdits` to gate the unknown-lines
// backstop: the backstop only fires when the existing body carries the
// CURRENT marker (so non-template lines really are maintainer edits). A
// missing or older marker means the body is older-template content and is
// treated as untouched-but-stale, so `planPrBodyRefresh` rewrites it with
// the new template. The regex signal (Verified by: / Waived: / checked
// boxes) still fires regardless, so real sign-off on an older template is
// still preserved.
export const SIGNOFF_TEMPLATE_VERSION_MARKER =
  "<!-- release-gate-template-version:v1 -->";

export function buildSignoffSection(gateDocUrl: string = resolveGateDocUrl()): string {
  const lines: string[] = [
    SIGNOFF_SECTION_HEADER,
    SIGNOFF_TEMPLATE_VERSION_MARKER,
    "",
    `Walk [\`docs/release-gate.md\`](${gateDocUrl}) against the merge candidate (the release branch's HEAD before the squash-merge). Resolve each pre-merge box below to a \`Verified by: <maintainer> — <YYYY-MM-DD>\` line or a \`Waived: <rationale referencing tracked follow-up>\` line before approving the squash-merge. The post-tag box is completed after \`release.yaml\` creates the GitHub Release.`,
    "",
    "**Pre-merge:**",
    "",
    `- [ ] Required validation block runs cleanly on the merge candidate (\`npm ci\` → \`npm run verify:prose-style\`); any \`npm audit\` advisories are triaged per [Required validation](${gateDocUrl}#required-validation) (fix, accept with documented rationale, or defer with a tracked issue).`,
    "- [ ] Dist reproducibility check is clean (`npm run build && git diff --exit-code -- dist package.json package-lock.json`).",
    "- [ ] Manual security regression checks for `review-reference-file` are confirmed against the merge candidate.",
    "- [ ] Prompt-artifact leakage check: the resolved `reviewReference` flowing into the assembled prompt comes only from the validated path-resolver, never raw runner-local content. Confirmed by `src/prepare/referenceFile.test.ts` (path validation) and `src/prepare/main.test.ts` ('uses the resolved custom reference content for each prompt'). Direct artifact inspection requires the dogfood workflow's `allow-users` (in `.github/workflows/codex-review.yaml`) to include the inspecting maintainer's account; release-bot PRs and scratch PRs from other accounts are skipped. The allow-listed maintainer can open a scratch PR against the merge candidate and run `gh run download <run-id> --name codex-prepare` within the prepare job's retention window. Other maintainers either widen `allow-users` on a scratch branch first or rely on the unit-test coverage above.",
    "- [ ] Conditional `review-reference-source: base` checks are run, or waived with a rationale.",
    `- [ ] Release-specific items table is filled below this checklist with cross-references to owning PRs/issues, and each row resolved to \`Verified by:\` or \`Waived:\` (see [Release-specific items](${gateDocUrl}#release-specific-items)).`,
    "- [ ] Trust-boundary CHANGELOG callout is present if any merged PR contributing a release level (i.e. not `release: skip`) is labeled `trust-boundary`. (Skipped PRs do not appear in CHANGELOG entries, so they cannot trigger the callout requirement.)",
    "",
    "**Post-tag:**",
    "",
    `- [ ] Gate evidence zip attached to the GitHub Release after the tag pushes (see [Archiving the gate](${gateDocUrl}#archiving-the-gate)).`,
    "",
    "### Release-specific items",
    "",
    `Populate the table below per [docs/release-gate.md → Release-specific items](${gateDocUrl}#release-specific-items). Add one row per release-specific item; resolve each State to \`Verified by:\` or \`Waived:\` per the sign-off convention. If the release has no items beyond the templated checks, replace the example row with \`_None — release contains only routine maintenance._\` and add a Verified-by line.`,
    "",
    "| # | Item | Owning work | State |",
    "|---|---|---|---|",
    "| 1 | _short description_ | _PR # / issue # / workflow file_ | _`Verified by: <maintainer> — <YYYY-MM-DD>` or `Waived: <rationale + tracked follow-up>`_ |",
  ];
  return lines.join("\n");
}

export function buildPrBody(args: {
  version: string;
  isPrerelease: boolean;
  prs: PullRequest[];
  baseTag: string | undefined;
  gateDocUrl?: string;
}): string {
  const url = args.gateDocUrl ?? resolveGateDocUrl();
  return `${buildAutoHeaderSection(args)}\n\n${buildSignoffSection(url)}`;
}

// Returns true if the existing release PR body shows ANY sign of maintainer
// engagement with the gate sign-off section. Two signals, ORed:
//
//   1. `existingBodyHasMaintainerSignoff` — explicit Verified by: / Waived:
//      lines or checked task-list rows (regex on stripped body). Always
//      consulted; fires regardless of which template version generated
//      the body.
//   2. Unknown-lines backstop — any non-blank line in the sign-off section
//      that is not byte-identical to a line in the bot's freshly generated
//      `buildSignoffSection()` template. Catches added notes, populated
//      release-specific table rows, modified checklist text — patterns that
//      would not match the regex. Only consulted when the existing body
//      carries the CURRENT `SIGNOFF_TEMPLATE_VERSION_MARKER`; if the marker
//      is missing or differs (older bot template, or marker stripped), the
//      existing body is treated as untouched-but-stale so reruns can refresh
//      it with the new template.
//
// The version-marker gate avoids the false-positive where a bot template
// change would otherwise classify every older-template body as "edited" and
// cause `planPrBodyRefresh` to preserve a stale checklist.
//
// Trade-off: a maintainer who edits an older-template body without writing a
// `Verified by:` / `Waived:` line, without checking a box, AND without
// preserving the version marker (e.g. an editor stripped the HTML comment)
// will have their edits classified as untouched-stale and overwritten on
// rerun. This is acceptable because the canonical sign-off path uses one of
// the regex-detected patterns; silent-prose-only edits on a template that
// has since changed are an unusual workflow. If preservation matters, write
// a `Verified by:` or `Waived:` line, tick a checkbox, or keep the
// `<!-- release-gate-template-version:vN -->` marker intact.
// Strips Markdown link targets (the URL inside parentheses) for the
// unknown-lines comparison. URL changes alone (server, repo, or branch
// rotated between runs) shouldn't make untouched bodies look edited; only
// structural / textual divergence should.
function normalizeLineForUnknownLinesCheck(line: string): string {
  return line.replace(/\(https?:\/\/[^)]+\)/g, "(URL)");
}

export function existingBodyHasMaintainerEdits(
  existingBody: string | null | undefined,
  gateDocUrl: string = resolveGateDocUrl(),
): boolean {
  if (existingBody === null || existingBody === undefined || existingBody === "") {
    return false;
  }
  if (existingBodyHasMaintainerSignoff(existingBody)) return true;
  const idx = findSignoffSectionStart(existingBody);
  if (idx === -1) return false;
  const signoffSection = existingBody.slice(idx);
  if (!signoffSection.includes(SIGNOFF_TEMPLATE_VERSION_MARKER)) {
    return false;
  }
  const templateLines = new Set(
    buildSignoffSection(gateDocUrl)
      .split("\n")
      .map((line) => normalizeLineForUnknownLinesCheck(line.trimEnd())),
  );
  for (const rawLine of signoffSection.split("\n")) {
    const line = normalizeLineForUnknownLinesCheck(rawLine.trimEnd());
    if (line === "") continue;
    if (!templateLines.has(line)) return true;
  }
  return false;
}

export type PrBodyRefreshPlan =
  | { mode: "fresh"; body: string }
  | { mode: "merge"; body: string }
  | { mode: "skip"; reason: string };

// Decides what to do with a release PR body on a `prepare-release.yaml` rerun:
//
// - `fresh` — write the full freshly generated template (auto-header +
//   sign-off scaffold). Used when the existing body has no maintainer
//   sign-off, so reruns pick up later checklist / template updates.
// - `merge` — refresh the auto-header (so the PR list, since-line,
//   pre-release flag, etc. reflect the latest merge candidate) but preserve
//   the sign-off section verbatim from `## Release gate sign-off` onward.
//   Used when sign-off has begun and the marker heading is intact.
// - `skip` — do not edit the body. Used when sign-off has begun but the
//   marker heading is missing (renamed by the maintainer, or sign-off
//   pasted into a legacy body). A surgical merge cannot find the boundary,
//   and replacing with a fresh template would erase the fills, so the bot
//   refuses to touch the body and asks the maintainer to restore the
//   marker if they want the auto-header refreshed.
export function planPrBodyRefresh(
  args: {
    version: string;
    isPrerelease: boolean;
    prs: PullRequest[];
    baseTag: string | undefined;
  },
  existingBody: string | null | undefined,
  gateDocUrl: string = resolveGateDocUrl(),
): PrBodyRefreshPlan {
  const freshHeader = buildAutoHeaderSection(args);
  const fullFreshBody = `${freshHeader}\n\n${buildSignoffSection(gateDocUrl)}`;

  if (existingBody === null || existingBody === undefined || existingBody === "") {
    return { mode: "fresh", body: fullFreshBody };
  }

  const hasEdits = existingBodyHasMaintainerEdits(existingBody, gateDocUrl);
  const markerIdx = findSignoffSectionStart(existingBody);

  if (!hasEdits) {
    return { mode: "fresh", body: fullFreshBody };
  }

  if (markerIdx === -1) {
    return {
      mode: "skip",
      reason:
        "PR body contains maintainer edits (sign-off lines, checked task-list rows, or added prose) but no `## Release gate sign-off` marker. Restore the marker heading if you want the bot to refresh the auto-generated header on reruns; otherwise the body is preserved verbatim.",
    };
  }

  return {
    mode: "merge",
    body: `${freshHeader}\n\n${existingBody.slice(markerIdx)}`,
  };
}

export type GhRunner = (args: string[]) => string;
export type GitRunner = (args: string[]) => string;

type ReleaseRow = { tagName: string; publishedAt: string; isPrerelease: boolean };
type PrSearchRow = {
  number: number;
  title: string;
  body: string | null;
  labels: Label[];
  url: string;
};

const PR_SEARCH_LIMIT = 1000;
const RELEASE_LIST_LIMIT = 100;

export type PrepareReleaseDeps = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
  runGh?: GhRunner;
  runGit?: GitRunner;
  today?: () => string;
  stdoutWrite?: (chunk: string) => void;
  stderrWrite?: (chunk: string) => void;
};

function makeDefaultRunGh(env: NodeJS.ProcessEnv): GhRunner {
  return (args) => execFileSync("gh", args, { encoding: "utf-8", env });
}

function makeDefaultRunGit(env: NodeJS.ProcessEnv): GitRunner {
  return (args) => execFileSync("git", args, { encoding: "utf-8", env });
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseCli(argv: string[]): { explicit: string | undefined; dryRun: boolean } {
  let explicit: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--version") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--version requires a value");
      explicit = next;
      i++;
    } else if (arg !== undefined && arg.startsWith("--version=")) {
      explicit = arg.slice("--version=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { explicit, dryRun };
}

function listReleases(runGh: GhRunner): ReleaseRow[] {
  const raw = runGh([
    "release",
    "list",
    "--limit",
    String(RELEASE_LIST_LIMIT),
    "--json",
    "tagName,publishedAt,isPrerelease",
  ]);
  return JSON.parse(raw) as ReleaseRow[];
}

function listExistingTags(runGit: GitRunner): Set<string> {
  const raw = runGit(["ls-remote", "--tags", "origin"]);
  const tags = new Set<string>();
  for (const line of raw.split("\n")) {
    const ref = line.trim().split(/\s+/)[1];
    if (ref === undefined) continue;
    const name = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
    if (name !== "" && name !== ref) tags.add(name);
  }
  return tags;
}

export function tagCommitTimestamp(runGit: GitRunner, tag: string): string {
  const raw = runGit(["log", "-1", "--format=%cI", `${tag}^{commit}`]).trim();
  if (raw === "") {
    throw new Error(
      `git log returned no commit timestamp for tag ${tag}; is the tag fetched locally?`,
    );
  }
  return raw;
}

function listMergedPrs(runGh: GhRunner, sincePublishedAt: string | undefined): PullRequest[] {
  const search = sincePublishedAt
    ? `merged:>${sincePublishedAt} base:main`
    : "is:merged base:main";
  const raw = runGh([
    "pr",
    "list",
    "--state",
    "merged",
    "--base",
    "main",
    "--search",
    search,
    "--json",
    "number,title,body,labels,url",
    "--limit",
    String(PR_SEARCH_LIMIT),
  ]);
  const rows = JSON.parse(raw) as PrSearchRow[];
  if (rows.length >= PR_SEARCH_LIMIT) {
    const sinceClause = sincePublishedAt
      ? `since ${sincePublishedAt}`
      : "since project inception (no prior non-pre-release tag found)";
    throw new Error(
      `gh pr list hit the ${PR_SEARCH_LIMIT}-result cap ${sinceClause}. The GitHub Search API caps at ~1000 results per query, so this script cannot prepare a single release covering more than ${PR_SEARCH_LIMIT} merged PRs. Cut interim releases manually first, or implement pagination in listMergedPrs.`,
    );
  }
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    body: row.body ?? "",
    labels: row.labels,
    url: row.url,
  }));
}

function unifiedDiff(label: string, before: string, after: string): string {
  if (before === after) return `# ${label}: no changes\n`;
  const dir = mkdtempSync(join(tmpdir(), "prepare-release-diff-"));
  const beforePath = join(dir, "before");
  const afterPath = join(dir, "after");
  try {
    writeFileSync(beforePath, before);
    writeFileSync(afterPath, after);
    const result = spawnSync(
      "git",
      [
        "diff",
        "--no-index",
        "--unified=3",
        `--src-prefix=a/`,
        `--dst-prefix=b/`,
        beforePath,
        afterPath,
      ],
      { encoding: "utf-8" },
    );
    const stdout = result.stdout ?? "";
    return stdout
      .replace(new RegExp(beforePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), label)
      .replace(new RegExp(afterPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), label);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runCli(deps: PrepareReleaseDeps = {}): number {
  const argv = deps.argv ?? process.argv.slice(2);
  const env = deps.env ?? process.env;
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, "utf-8"));
  const writeFile =
    deps.writeFile ?? ((path: string, content: string) => writeFileSync(path, content));
  const runGh = deps.runGh ?? makeDefaultRunGh(env);
  const runGit = deps.runGit ?? makeDefaultRunGit(env);
  const today = (deps.today ?? defaultToday)();
  const stdoutWrite = deps.stdoutWrite ?? ((chunk: string) => process.stdout.write(chunk));
  const stderrWrite = deps.stderrWrite ?? ((chunk: string) => process.stderr.write(chunk));

  try {
    const { explicit, dryRun } = parseCli(argv);
    if (explicit !== undefined) parseTargetVersion(explicit);

    const releases = listReleases(runGh);
    const baseRelease = selectLastNonPrereleaseTag(releases);
    const existingTags = listExistingTags(runGit);
    const cutoff = baseRelease ? tagCommitTimestamp(runGit, baseRelease.tagName) : undefined;
    const prs = listMergedPrs(runGh, cutoff);

    for (const pr of prs) {
      releaseLevelOf(pr);
    }

    const packageJson = readFile("package.json");
    const parsedPackageJson = JSON.parse(packageJson) as Record<string, unknown>;
    const rawCurrentVersion = parsedPackageJson.version;
    if (typeof rawCurrentVersion !== "string" || rawCurrentVersion === "") {
      throw new Error(
        "package.json is missing a string 'version' field; cannot compute the next release version.",
      );
    }
    parseVersion(rawCurrentVersion);
    const currentVersion = rawCurrentVersion;
    const baseVersion = baseRelease
      ? baseRelease.tagName.replace(/^v/, "")
      : currentVersion;
    const targetVersion = resolveTargetVersion({
      explicit,
      baseVersion,
      prs,
      existingTags,
    });
    const isPre = isPrereleaseVersion(targetVersion);

    const updatedPackageJson = bumpPackageJsonVersion(packageJson, targetVersion);
    const packageLock = readFile("package-lock.json");
    const updatedPackageLock = bumpPackageLockVersion(packageLock, targetVersion);
    const changelog = readFile("CHANGELOG.md");
    const updatedChangelog = applyChangelogUpdate(changelog, targetVersion, today, prs);

    if (dryRun) {
      stdoutWrite(unifiedDiff("package.json", packageJson, updatedPackageJson));
      stdoutWrite(unifiedDiff("package-lock.json", packageLock, updatedPackageLock));
      stdoutWrite(unifiedDiff("CHANGELOG.md", changelog, updatedChangelog));
      stdoutWrite(`# Target version: ${targetVersion} (${isPre ? "pre-release" : "release"})\n`);
      return 0;
    }

    const branch = `release/v${targetVersion}`;
    const botUserId = env.RELEASE_APP_BOT_USER_ID;
    const botLogin = "codex-review-action-release-bot[bot]";
    if (!botUserId) {
      throw new Error(
        "RELEASE_APP_BOT_USER_ID env var is required (the bot user ID is needed to author commits with the canonical noreply email and to verify the release branch contains only bot commits).",
      );
    }
    const botEmail = `${botUserId}+${botLogin}@users.noreply.github.com`;

    const remoteRef = runGit(["ls-remote", "--heads", "origin", branch]).trim();
    let remoteSha = "";
    if (remoteRef !== "") {
      runGit(["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
      remoteSha = runGit(["rev-parse", `refs/remotes/origin/${branch}`]).trim();
      const log = runGit([
        "log",
        "--format=%H%x09%ae%x09%ce",
        `origin/${branch}`,
        `^origin/main`,
      ]);
      const nonBot = log
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => {
          const [, authorEmail = "", committerEmail = ""] = line.split("\t");
          return authorEmail !== botEmail || committerEmail !== botEmail;
        });
      if (nonBot.length > 0) {
        throw new Error(
          `Refusing to force-push ${branch}: it contains commits whose author or committer is not the release bot:\n${nonBot.join("\n")}\nRebase or delete the branch manually before re-running.`,
        );
      }
    }

    runGit(["checkout", "-B", branch, "origin/main"]);
    writeFile("package.json", updatedPackageJson);
    writeFile("package-lock.json", updatedPackageLock);
    writeFile("CHANGELOG.md", updatedChangelog);
    runGit(["config", "user.name", botLogin]);
    runGit(["config", "user.email", botEmail]);
    runGit(["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
    const stagedDiff = runGit(["diff", "--cached", "--name-only"]).trim();
    const hasFileChanges = stagedDiff !== "";
    if (hasFileChanges) {
      runGit(["commit", "-m", `release: v${targetVersion}`]);
      if (remoteSha === "") {
        runGit(["push", "origin", branch]);
      } else {
        runGit(["push", `--force-with-lease=${branch}:${remoteSha}`, "origin", branch]);
      }
    } else {
      stdoutWrite(
        `No file changes for v${targetVersion}: package.json, package-lock.json, and CHANGELOG.md on origin/main already match the computed output. Skipping commit/push; continuing to release PR body refresh so reruns can pick up template updates.\n`,
      );
      if (remoteSha !== "") {
        stdoutWrite(
          `Warning: release branch ${branch} exists on origin (sha=${remoteSha}) but no commit was made this run. If the branch's diff against origin/main no longer reflects the intended release (e.g. main has advanced past the bumped state), close the existing release PR and delete the branch manually before re-running.\n`,
        );
      }
    }

    let gitFallback: { host: string; repo: string; defaultBranch?: string } | undefined;
    try {
      const remoteUrl = runGit(["remote", "get-url", "origin"]).trim();
      const parsed = parseGitRemoteUrl(remoteUrl);
      if (parsed !== null) {
        let defaultBranch: string | undefined;
        try {
          const ref = runGit(["symbolic-ref", "refs/remotes/origin/HEAD"]).trim();
          const m = /^refs\/remotes\/origin\/(.+)$/.exec(ref);
          if (m && m[1] !== undefined) defaultBranch = m[1];
        } catch {
          // origin/HEAD not set; defaultBranch stays undefined and
          // resolveGateDocUrl falls back to its built-in default ("main").
        }
        gitFallback = { ...parsed, defaultBranch };
      }
    } catch {
      // git remote unavailable; resolveGateDocUrl falls back to the
      // hard-coded upstream default.
    }
    // Intentionally do not pin the URL to the ephemeral release branch:
    // release branches are deleted after merge, and the PR description
    // continues to serve as audit surface post-merge for the post-tag
    // checklist. Resolve to the default branch (env GITHUB_REF_NAME → git
    // symbolic-ref refs/remotes/origin/HEAD → "main") so the link stays
    // valid for the lifetime of the merged PR. The minor risk that the
    // gate doc on the default branch may advance past the merge candidate
    // during release prep is documented in docs/release-gate.md; in
    // practice the release branch is created from default-branch HEAD and
    // the gate doc is not edited on the release branch, so the two copies
    // are effectively identical at review time.
    const gateDocUrl = resolveGateDocUrl(env, gitFallback);
    const prBodyArgs = {
      version: targetVersion,
      isPrerelease: isPre,
      prs,
      baseTag: baseRelease?.tagName,
      gateDocUrl,
    } as const;
    const existingPr = runGh([
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number",
    ]);
    const openPrs = JSON.parse(existingPr) as Array<{ number: number }>;
    const firstOpenPr = openPrs[0];
    if (firstOpenPr === undefined) {
      if (!hasFileChanges) {
        stdoutWrite(
          `No file changes and no existing release PR for v${targetVersion}; nothing to do.\n`,
        );
        return 0;
      }
      runGh([
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        `release: v${targetVersion}`,
        "--label",
        "release: skip",
        "--body",
        buildPrBody(prBodyArgs),
      ]);
      stdoutWrite(`Opened release PR for v${targetVersion} on branch ${branch}.\n`);
    } else {
      const number = firstOpenPr.number;
      if (!hasFileChanges && remoteSha !== "") {
        // Distinguish "branch tip matches main+bumps" (safe to refresh body)
        // from "branch tip diverges from main" (stale; skip and warn).
        // Tree-hash equality is sufficient — if both refs point at the same
        // tree the PR body refresh describes a state byte-identical to the
        // branch tip, regardless of commit-graph history.
        let branchTreeMatchesMain = false;
        try {
          const branchTree = runGit(["rev-parse", `${remoteSha}^{tree}`]).trim();
          const mainTree = runGit(["rev-parse", "origin/main^{tree}"]).trim();
          if (branchTree !== "" && branchTree === mainTree) {
            branchTreeMatchesMain = true;
          }
        } catch {
          // rev-parse failed; treat as unknown state and prefer the safe
          // skip-and-warn path below.
        }
        if (!branchTreeMatchesMain) {
          stdoutWrite(
            `Skipping PR body refresh on release PR #${number}: no commit was pushed this run and the remote release branch ${branch} (sha=${remoteSha}) does not match origin/main's tree. Refreshing the body now would describe a state that does not match the branch tip; close the PR or delete the branch and re-run if a refresh is required.\n`,
          );
          return 0;
        }
        stdoutWrite(
          `Release branch ${branch} (sha=${remoteSha}) matches origin/main's tree; refreshing PR body to pick up template updates.\n`,
        );
      }
      const existingBodyJson = runGh([
        "pr",
        "view",
        String(number),
        "--json",
        "body",
      ]);
      const existingBody = (JSON.parse(existingBodyJson) as { body: string | null }).body;
      const plan = planPrBodyRefresh(prBodyArgs, existingBody, gateDocUrl);
      switch (plan.mode) {
        case "fresh":
          runGh(["pr", "edit", String(number), "--body", plan.body]);
          stdoutWrite(
            `Updated existing release PR #${number} for v${targetVersion} on branch ${branch}.\n`,
          );
          break;
        case "merge":
          runGh(["pr", "edit", String(number), "--body", plan.body]);
          stdoutWrite(
            `Refreshed auto-generated header on release PR #${number} for v${targetVersion}; preserved gate sign-off section verbatim. If the included-PRs list or CHANGELOG content changed, re-verify the gate before approving the squash-merge.\n`,
          );
          if (
            existingBody !== null &&
            !existingBody.includes(SIGNOFF_TEMPLATE_VERSION_MARKER)
          ) {
            stdoutWrite(
              `WARNING: the preserved sign-off section was generated by an older sign-off template (it lacks the current ${SIGNOFF_TEMPLATE_VERSION_MARKER} marker). The merged body keeps the maintainer's existing fills but does not inject any new gate items the template added since. Compare the preserved section against docs/release-gate.md (or buildSignoffSection in scripts/prepare-release.ts) and append/check any missing items manually before approving the squash-merge.\n`,
            );
          }
          break;
        case "skip":
          stdoutWrite(
            `Skipping body update on release PR #${number} for v${targetVersion}: ${plan.reason}\n`,
          );
          break;
      }
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderrWrite(`${message}\n`);
    return 1;
  }
}

function isInvokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  process.exit(runCli());
}
