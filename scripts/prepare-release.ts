import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
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
    if (best === "none" || LEVEL_RANK[level] > LEVEL_RANK[best as VersionBump]) {
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
  currentVersion: string;
  prs: PullRequest[];
  existingTags: ReadonlySet<string>;
}): string {
  const { explicit, currentVersion, prs, existingTags } = args;
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
  return bumpVersion(currentVersion, bump);
}

export function buildPrBody(args: {
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

const PR_SEARCH_LIMIT = 200;
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

function defaultRunGh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf-8" });
}

function defaultRunGit(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf-8" });
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
    throw new Error(
      `gh pr list returned ${PR_SEARCH_LIMIT} results (the per-call cap). Cut a release more often or raise PR_SEARCH_LIMIT.`,
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
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines: string[] = [`--- a/${label}`, `+++ b/${label}`];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) continue;
    if (b !== undefined) lines.push(`-${b}`);
    if (a !== undefined) lines.push(`+${a}`);
  }
  return `${lines.join("\n")}\n`;
}

export function runCli(deps: PrepareReleaseDeps = {}): number {
  const argv = deps.argv ?? process.argv.slice(2);
  const env = deps.env ?? process.env;
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, "utf-8"));
  const writeFile =
    deps.writeFile ?? ((path: string, content: string) => writeFileSync(path, content));
  const runGh = deps.runGh ?? defaultRunGh;
  const runGit = deps.runGit ?? defaultRunGit;
  const today = (deps.today ?? defaultToday)();
  const stdoutWrite = deps.stdoutWrite ?? ((chunk: string) => process.stdout.write(chunk));
  const stderrWrite = deps.stderrWrite ?? ((chunk: string) => process.stderr.write(chunk));

  try {
    const { explicit, dryRun } = parseCli(argv);
    if (explicit !== undefined) parseTargetVersion(explicit);

    const releases = listReleases(runGh);
    const baseRelease = selectLastNonPrereleaseTag(releases);
    const existingTags = listExistingTags(runGit);
    const prs = listMergedPrs(runGh, baseRelease?.publishedAt);

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
    const targetVersion = resolveTargetVersion({
      explicit,
      currentVersion,
      prs,
      existingTags,
    });
    const isPre = isPrereleaseVersion(targetVersion);

    const updatedPackageJson = bumpPackageJsonVersion(packageJson, targetVersion);
    const changelog = readFile("CHANGELOG.md");
    const updatedChangelog = applyChangelogUpdate(changelog, targetVersion, today, prs);

    if (dryRun) {
      stdoutWrite(unifiedDiff("package.json", packageJson, updatedPackageJson));
      stdoutWrite(unifiedDiff("CHANGELOG.md", changelog, updatedChangelog));
      stdoutWrite(`# Target version: ${targetVersion} (${isPre ? "pre-release" : "release"})\n`);
      return 0;
    }

    const branch = `release/v${targetVersion}`;
    const botUserId = env.RELEASE_APP_BOT_USER_ID ?? "";
    const botLogin = "codex-review-action-release-bot[bot]";
    const botEmail = botUserId
      ? `${botUserId}+${botLogin}@users.noreply.github.com`
      : `${botLogin}@users.noreply.github.com`;

    const remoteRef = runGit(["ls-remote", "--heads", "origin", branch]).trim();
    let remoteSha = "";
    if (remoteRef !== "") {
      remoteSha = remoteRef.split(/\s+/, 1)[0] ?? "";
      runGit(["fetch", "origin", `+${remoteSha}:refs/remotes/origin/${branch}`]);
      const log = runGit([
        "log",
        "--format=%H%x09%ae%x09%ce",
        `${remoteSha}`,
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
    writeFile("CHANGELOG.md", updatedChangelog);
    runGit(["config", "user.name", botLogin]);
    runGit(["config", "user.email", botEmail]);
    runGit(["add", "package.json", "CHANGELOG.md"]);
    runGit(["commit", "-m", `release: v${targetVersion}`]);
    if (remoteSha === "") {
      runGit(["push", "origin", branch]);
    } else {
      runGit(["push", `--force-with-lease=${branch}:${remoteSha}`, "origin", branch]);
    }

    const prBody = buildPrBody({
      version: targetVersion,
      isPrerelease: isPre,
      prs,
      baseTag: baseRelease?.tagName,
    });
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
        prBody,
      ]);
      stdoutWrite(`Opened release PR for v${targetVersion} on branch ${branch}.\n`);
    } else {
      const number = firstOpenPr.number;
      runGh(["pr", "edit", String(number), "--body", prBody]);
      stdoutWrite(`Updated existing release PR #${number} for v${targetVersion} on branch ${branch}.\n`);
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
