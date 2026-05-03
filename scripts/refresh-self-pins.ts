import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseVersion } from "./changelog.js";

const SELF_PIN_PATTERN =
  /(milanhorvatovic\/codex-ai-code-review-action)(\/[\w./-]+?)?@[0-9a-f]{40}(?:[ \t]*#[ \t]*[\w.+-]+)?/g;

const FAIL_ON_MISSING_COMMENTED =
  /^(\s*)#\s*fail-on-missing-chunks:\s*"true"\s*(?:#[^\n]*)?$/;

const ISSUE_44_INTRO_LINE = /^When you adopt a release that contains \[issue #44\]/;

const SHA_TAG_NOTE = /(# SHA corresponds to tag )v\d+\.\d+\.\d+( — update when adopting a new release\.)/g;

function validateSelfPinInputs(version: string, sha: string): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`SHA must be a 40-character hex string; got ${sha}`);
  }
  parseVersion(version);
}

function rewriteSelfPinValidated(line: string, version: string, sha: string): string {
  return line.replace(SELF_PIN_PATTERN, (_match, owner: string, sub: string | undefined) => {
    const subPath = sub ?? "";
    return `${owner}${subPath}@${sha} # v${version}`;
  });
}

export function rewriteSelfPin(line: string, version: string, sha: string): string {
  validateSelfPinInputs(version, sha);
  return rewriteSelfPinValidated(line, version, sha);
}

export function rewriteAllSelfPins(content: string, version: string, sha: string): string {
  validateSelfPinInputs(version, sha);
  return content
    .split("\n")
    .map((line) => rewriteSelfPinValidated(line, version, sha))
    .join("\n");
}

export function uncommentFailOnMissingChunks(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const match = FAIL_ON_MISSING_COMMENTED.exec(line);
      if (!match) return line;
      const indent = match[1] ?? "";
      return `${indent}fail-on-missing-chunks: "true"`;
    })
    .join("\n");
}

export function removeIssue44Paragraph(content: string): string {
  const lines = content.split("\n");
  const idx = lines.findIndex((line) => ISSUE_44_INTRO_LINE.test(line));
  if (idx === -1) return content;
  const before = idx > 0 && (lines[idx - 1] ?? "") === "" ? idx - 1 : idx;
  let after = idx + 1;
  while (after < lines.length && (lines[after] ?? "") !== "") after++;
  while (after < lines.length && (lines[after] ?? "") === "") after++;
  const beforeLines = lines.slice(0, before);
  const afterLines = lines.slice(after);
  if (beforeLines.length === 0 || afterLines.length === 0) {
    return [...beforeLines, ...afterLines].join("\n");
  }
  return [...beforeLines, "", ...afterLines].join("\n");
}

export function rewriteShaTagNote(content: string, version: string): string {
  parseVersion(version);
  return content.replace(SHA_TAG_NOTE, (_match, prefix: string, suffix: string) => {
    return `${prefix}v${version}${suffix}`;
  });
}

export function refreshReadme(content: string, version: string, sha: string): string {
  let next = rewriteAllSelfPins(content, version, sha);
  next = rewriteShaTagNote(next, version);
  next = uncommentFailOnMissingChunks(next);
  next = removeIssue44Paragraph(next);
  return next;
}

export function refreshWorkflow(content: string, version: string, sha: string): string {
  return rewriteAllSelfPins(content, version, sha);
}

export const SELF_PIN_TARGETS: ReadonlyArray<{
  path: string;
  refresh: (content: string, version: string, sha: string) => string;
}> = [
  { path: "README.md", refresh: refreshReadme },
  { path: ".github/workflows/codex-review.yaml", refresh: refreshWorkflow },
];

export type RunCliDeps = {
  argv?: string[];
  readSource?: (path: string) => string;
  writeSource?: (path: string, content: string) => void;
  stdoutWrite?: (chunk: string) => void;
  stderrWrite?: (chunk: string) => void;
};

function defaultReadSource(path: string): string {
  return readFileSync(path, "utf-8");
}

function defaultWriteSource(path: string, content: string): void {
  writeFileSync(path, content);
}

function defaultStdoutWrite(chunk: string): void {
  process.stdout.write(chunk);
}

function defaultStderrWrite(chunk: string): void {
  process.stderr.write(chunk);
}

export function runCli(deps: RunCliDeps = {}): number {
  const argv = deps.argv ?? process.argv.slice(2);
  const readSource = deps.readSource ?? defaultReadSource;
  const writeSource = deps.writeSource ?? defaultWriteSource;
  const stdoutWrite = deps.stdoutWrite ?? defaultStdoutWrite;
  const stderrWrite = deps.stderrWrite ?? defaultStderrWrite;

  if (argv.length !== 2 || argv[0] === undefined || argv[1] === undefined) {
    stderrWrite(
      [
        "Usage:",
        "  npx tsx scripts/refresh-self-pins.ts <version> <commit-sha>",
        "",
      ].join("\n"),
    );
    return 1;
  }

  const version = argv[0];
  const sha = argv[1];

  try {
    const pendingWrites: Array<{ path: string; original: string; updated: string }> = [];
    const unchangedPaths: string[] = [];
    for (const target of SELF_PIN_TARGETS) {
      const original = readSource(target.path);
      const updated = target.refresh(original, version, sha);
      if (updated === original) {
        unchangedPaths.push(target.path);
        continue;
      }
      pendingWrites.push({ path: target.path, original, updated });
    }
    if (pendingWrites.length === 0) {
      stdoutWrite("All self-pin targets already up to date; no changes written.\n");
      return 0;
    }
    const writtenPaths: string[] = [];
    let inFlightPath: string | undefined;
    try {
      for (const write of pendingWrites) {
        inFlightPath = write.path;
        writeSource(write.path, write.updated);
        writtenPaths.push(write.path);
        inFlightPath = undefined;
      }
    } catch (writeErr) {
      // Best-effort rollback so a mid-write failure does not leave the working tree partially
      // updated. Includes the in-flight path so a write that throws after truncating the file
      // also gets restored to its original content.
      const toRollback = inFlightPath === undefined ? writtenPaths : [...writtenPaths, inFlightPath];
      for (const path of toRollback) {
        const original = pendingWrites.find((w) => w.path === path)?.original;
        if (original === undefined) continue;
        try {
          writeSource(path, original);
        } catch {
          // Surface the original write error; rollback failures are secondary.
        }
      }
      throw writeErr;
    }
    stdoutWrite(
      `Refreshed self-pin SHAs to ${sha} (v${version}) in: ${pendingWrites
        .map((w) => w.path)
        .join(", ")}.\n`,
    );
    if (unchangedPaths.length > 0) {
      stdoutWrite(`Already up to date: ${unchangedPaths.join(", ")}.\n`);
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
