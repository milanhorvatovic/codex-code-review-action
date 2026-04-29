import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION_BASE = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(.+))?$/;
const PRERELEASE_IDENT = /^[0-9A-Za-z-]+$/;

export function parseVersion(input: string): string {
  if (input === "Unreleased") {
    throw new Error(
      "Refusing to extract the Unreleased section directly; pass a released or pre-release version (e.g. 2.0.0 or 2.1.0-rc.1).",
    );
  }
  if (input.startsWith("v")) {
    throw new Error("Strip the leading 'v'; pass 1.0.0 not v1.0.0.");
  }
  if (input.includes("+")) {
    throw new Error(
      "Build metadata not supported; pass MAJOR.MINOR.PATCH[-PRERELEASE] only.",
    );
  }
  const match = VERSION_BASE.exec(input);
  if (!match) {
    throw new Error("Invalid version; expected MAJOR.MINOR.PATCH[-PRERELEASE].");
  }
  const prerelease = match[1];
  if (prerelease !== undefined) {
    const idents = prerelease.split(".");
    for (const ident of idents) {
      if (!PRERELEASE_IDENT.test(ident)) {
        throw new Error(
          "Invalid version; expected MAJOR.MINOR.PATCH[-PRERELEASE].",
        );
      }
      if (/^[0-9]+$/.test(ident) && ident.length > 1 && ident.startsWith("0")) {
        throw new Error(
          "Numeric pre-release identifiers may not have leading zeros.",
        );
      }
    }
  }
  return input;
}

export function findSection(
  changelog: string,
  version: string,
): { startIndex: number; endIndex: number } {
  const lines = changelog.split("\n");
  const headingPrefix = `## [${version}]`;
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (!line.startsWith(headingPrefix)) continue;
    const after = line.slice(headingPrefix.length);
    if (after !== "" && !after.startsWith(" ")) continue;
    matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(`Section ## [${version}] not found in CHANGELOG.md`);
  }
  if (matches.length > 1) {
    const lineNumbers = matches.map((i) => i + 1).join(", ");
    throw new Error(
      `Multiple ## [${version}] headings at lines ${lineNumbers}`,
    );
  }
  const startIndex = matches[0] ?? 0;
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i]?.startsWith("## [")) {
      endIndex = i;
      break;
    }
  }
  return { startIndex, endIndex };
}

export function extractSectionContent(
  changelog: string,
  version: string,
): string {
  const { startIndex, endIndex } = findSection(changelog, version);
  const lines = changelog.split("\n");
  const body = lines.slice(startIndex + 1, endIndex);
  let start = 0;
  let end = body.length;
  while (start < end && (body[start] ?? "").trim() === "") start++;
  while (end > start && (body[end - 1] ?? "").trim() === "") end--;
  if (start === end) {
    throw new Error(`Section ## [${version}] is empty`);
  }
  return body.slice(start, end).join("\n");
}

function defaultReadSource(path: string): string {
  return readFileSync(path, "utf-8");
}

function defaultStdoutWrite(chunk: string): void {
  process.stdout.write(chunk);
}

function defaultStderrWrite(chunk: string): void {
  process.stderr.write(chunk);
}

export type RunCliDeps = {
  argv?: string[];
  readSource?: (path: string) => string;
  stdoutWrite?: (chunk: string) => void;
  stderrWrite?: (chunk: string) => void;
};

export function runCli(deps: RunCliDeps = {}): number {
  const argv = deps.argv ?? process.argv.slice(2);
  const readSource = deps.readSource ?? defaultReadSource;
  const stdoutWrite = deps.stdoutWrite ?? defaultStdoutWrite;
  const stderrWrite = deps.stderrWrite ?? defaultStderrWrite;

  if (argv.length !== 1 || argv[0] === undefined) {
    stderrWrite(
      [
        "Usage:",
        "  npm run extract:changelog -- <version>",
        "  npx tsx scripts/extract-changelog-section.ts <version>",
        "",
      ].join("\n"),
    );
    return 1;
  }

  try {
    const version = parseVersion(argv[0]);
    const content = extractSectionContent(readSource("CHANGELOG.md"), version);
    stdoutWrite(`${content}\n`);
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
