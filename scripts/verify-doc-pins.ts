import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type CanonicalLocation = { path: string; line: number };
export type CanonicalEntry = { sha: string; tag?: string; location: CanonicalLocation };
export type CanonicalMap = Map<string, CanonicalEntry>;

export type YamlSource = { path: string; content: string };
export type MdSource = { path: string; content: string };

export type DocMismatch = {
  kind: "doc-mismatch";
  file: string;
  line: number;
  key: string;
  foundSha: string;
  foundTag?: string;
  expectedSha: string;
  expectedTag?: string;
  canonicalLocation: CanonicalLocation;
};

export type YamlDisagreement = {
  kind: "yaml-disagreement";
  key: string;
  occurrences: Array<{ path: string; line: number; sha: string; tag?: string }>;
};

export type Drift = DocMismatch | YamlDisagreement;

export const SELF_REPO = "milanhorvatovic/codex-ai-code-review-action";

export const PIN_PATTERN =
  /(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)(?:\/(?<sub>[\w./-]+?))?@(?<sha>[0-9a-f]{40})(?:[ \t]*#[ \t]*(?<tag>[\w.+-]+))?/g;

const ALLOWLIST_MARKER = "<!-- pin-check: ignore -->";

type PinGroups = {
  owner?: string;
  repo?: string;
  sub?: string;
  sha?: string;
  tag?: string;
};

function readGroups(match: RegExpMatchArray): PinGroups | undefined {
  return match.groups as PinGroups | undefined;
}

function lineNumberOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

function previousNonBlankLine(lines: string[], lineNumber: number): string | undefined {
  for (let i = lineNumber - 2; i >= 0; i--) {
    const candidate = lines[i];
    if (candidate === undefined) continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export function buildCanonicalMap(yamls: YamlSource[]): {
  map: CanonicalMap;
  disagreements: YamlDisagreement[];
} {
  const occurrences = new Map<
    string,
    Array<{ path: string; line: number; sha: string; tag?: string }>
  >();

  for (const { path, content } of yamls) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === undefined) continue;
      const usesIdx = raw.indexOf("uses:");
      if (usesIdx === -1) continue;
      const tail = raw.slice(usesIdx + "uses:".length).trimStart();
      if (tail.startsWith("./") || tail.startsWith(".\\")) continue;
      PIN_PATTERN.lastIndex = 0;
      const match = PIN_PATTERN.exec(raw);
      PIN_PATTERN.lastIndex = 0;
      if (!match) continue;
      const groups = readGroups(match);
      if (!groups?.owner || !groups.repo || !groups.sha) continue;
      const key = `${groups.owner}/${groups.repo}`;
      if (key === SELF_REPO) continue;
      const list = occurrences.get(key) ?? [];
      list.push({ path, line: i + 1, sha: groups.sha, tag: groups.tag });
      occurrences.set(key, list);
    }
  }

  const map: CanonicalMap = new Map();
  const disagreements: YamlDisagreement[] = [];

  for (const key of [...occurrences.keys()].sort()) {
    const list = occurrences.get(key) ?? [];
    const sorted = [...list].sort((a, b) =>
      a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path),
    );
    const first = sorted[0];
    if (!first) continue;
    const distinct = new Set(sorted.map((o) => `${o.sha}#${o.tag ?? ""}`));
    if (distinct.size > 1) {
      disagreements.push({ kind: "yaml-disagreement", key, occurrences: sorted });
    }
    map.set(key, {
      sha: first.sha,
      tag: first.tag,
      location: { path: first.path, line: first.line },
    });
  }

  return { map, disagreements };
}

export function findDocDrift(canonical: CanonicalMap, mds: MdSource[]): DocMismatch[] {
  const drifts: DocMismatch[] = [];
  for (const { path, content } of mds) {
    const lines = content.split("\n");
    PIN_PATTERN.lastIndex = 0;
    for (const match of content.matchAll(PIN_PATTERN)) {
      const groups = readGroups(match);
      if (!groups?.owner || !groups.repo || !groups.sha) continue;
      const key = `${groups.owner}/${groups.repo}`;
      if (key === SELF_REPO) continue;
      const canon = canonical.get(key);
      if (!canon) continue;
      const index = match.index ?? 0;
      const lineNumber = lineNumberOf(content, index);
      const prev = previousNonBlankLine(lines, lineNumber);
      if (prev === ALLOWLIST_MARKER) continue;
      const shaMismatch = canon.sha !== groups.sha;
      const tagMismatch = (canon.tag ?? undefined) !== (groups.tag ?? undefined);
      if (!shaMismatch && !tagMismatch) continue;
      drifts.push({
        kind: "doc-mismatch",
        file: path,
        line: lineNumber,
        key,
        foundSha: groups.sha,
        foundTag: groups.tag,
        expectedSha: canon.sha,
        expectedTag: canon.tag,
        canonicalLocation: canon.location,
      });
    }
  }
  return drifts;
}

const SHORT_SHA_LEN = 6;

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LEN);
}

export function formatDrift(drift: Drift): string {
  if (drift.kind === "yaml-disagreement") {
    const list = drift.occurrences
      .map((o) => `  - ${o.path}:${o.line}: @${o.sha}${o.tag ? ` # ${o.tag}` : ""}`)
      .join("\n");
    return `canonical-pin disagreement for ${drift.key}:\n${list}`;
  }
  const found = `@${shortSha(drift.foundSha)}...${drift.foundTag ? ` # ${drift.foundTag}` : ""}`;
  const expected = `@${shortSha(drift.expectedSha)}...${drift.expectedTag ? ` # ${drift.expectedTag}` : ""}`;
  return `${drift.file}:${drift.line}: ${drift.key} — found ${found}, expected ${expected} (canonical: ${drift.canonicalLocation.path}:${drift.canonicalLocation.line})`;
}

function defaultGitLsFiles(...patterns: string[]): string[] {
  const stdout = execFileSync("git", ["ls-files", "--", ...patterns], { encoding: "utf-8" });
  return stdout.split("\n").filter((s) => s.length > 0);
}

function defaultReadSource(path: string): string {
  return readFileSync(path, "utf-8");
}

function defaultStderrWrite(chunk: string): void {
  process.stderr.write(chunk);
}

export type RunCliDeps = {
  gitLsFiles?: (...patterns: string[]) => string[];
  readSource?: (path: string) => string;
  stderrWrite?: (chunk: string) => void;
};

export function runCli(deps: RunCliDeps = {}): number {
  const lsFiles = deps.gitLsFiles ?? defaultGitLsFiles;
  const readSource = deps.readSource ?? defaultReadSource;
  const writeErr = deps.stderrWrite ?? defaultStderrWrite;

  const yamls = lsFiles("*.yaml").map((p) => ({ path: p, content: readSource(p) }));
  const mds = lsFiles("*.md").map((p) => ({ path: p, content: readSource(p) }));

  const { map, disagreements } = buildCanonicalMap(yamls);
  if (disagreements.length > 0) {
    for (const d of disagreements) writeErr(`${formatDrift(d)}\n`);
    return 1;
  }

  const drifts = findDocDrift(map, mds);
  if (drifts.length > 0) {
    for (const d of drifts) writeErr(`${formatDrift(d)}\n`);
    return 1;
  }

  return 0;
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
