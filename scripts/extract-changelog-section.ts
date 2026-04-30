import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { extractSectionContent, parseVersion } from "./changelog.js";

export { extractSectionContent, findSection, parseVersion } from "./changelog.js";

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
