import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveReviewReferenceFromBase,
} from "./referenceFile.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).toString("utf8");
}

describe("resolveReviewReferenceFromBase (real git)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    repoDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "ref-base-")),
    );
    git(["init", "--quiet", "--initial-branch=main"], repoDir);
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { force: true, recursive: true });
  });

  it("returns the BASE-SHA content when the workspace copy diverges", async () => {
    const refPath = ".github/codex/review-reference.md";
    fs.mkdirSync(path.join(repoDir, ".github/codex"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, refPath), "BASE policy\n");
    git(["add", "."], repoDir);
    git(["commit", "--quiet", "-m", "base policy"], repoDir);
    const baseSha = git(["rev-parse", "HEAD"], repoDir).trim();

    fs.writeFileSync(path.join(repoDir, refPath), "MODIFIED policy in workspace\n");

    const result = await resolveReviewReferenceFromBase(refPath, baseSha);
    expect(result).toBe("BASE policy\n");
    expect(fs.readFileSync(path.join(repoDir, refPath), "utf8")).toBe(
      "MODIFIED policy in workspace\n",
    );
  });

  it("returns the BASE-SHA content when a divergent commit advances HEAD", async () => {
    const refPath = ".github/codex/review-reference.md";
    fs.mkdirSync(path.join(repoDir, ".github/codex"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, refPath), "BASE policy\n");
    git(["add", "."], repoDir);
    git(["commit", "--quiet", "-m", "base policy"], repoDir);
    const baseSha = git(["rev-parse", "HEAD"], repoDir).trim();

    fs.writeFileSync(path.join(repoDir, refPath), "HEAD policy from a later commit\n");
    git(["add", "."], repoDir);
    git(["commit", "--quiet", "-m", "head policy"], repoDir);

    const result = await resolveReviewReferenceFromBase(refPath, baseSha);
    expect(result).toBe("BASE policy\n");
  });

  it("rejects a path that does not exist at the base SHA with a diagnostic naming the SHA and path", async () => {
    fs.writeFileSync(path.join(repoDir, "README.md"), "seed\n");
    git(["add", "."], repoDir);
    git(["commit", "--quiet", "-m", "seed"], repoDir);
    const baseSha = git(["rev-parse", "HEAD"], repoDir).trim();

    await expect(
      resolveReviewReferenceFromBase(".github/codex/review-reference.md", baseSha),
    ).rejects.toThrow(
      new RegExp(
        `'\\.github/codex/review-reference\\.md' does not exist at ${baseSha}`,
      ),
    );
  });

  it("rejects a tracked symbolic link committed at the base SHA", async () => {
    fs.writeFileSync(path.join(repoDir, "real.md"), "real\n");
    fs.symlinkSync("real.md", path.join(repoDir, "link.md"));
    git(["add", "."], repoDir);
    git(["commit", "--quiet", "-m", "tracked symlink"], repoDir);
    const baseSha = git(["rev-parse", "HEAD"], repoDir).trim();

    await expect(
      resolveReviewReferenceFromBase("link.md", baseSha),
    ).rejects.toThrow(/symbolic link at base SHA/);
  });

  it("rejects an unknown SHA with a git-shell diagnostic", async () => {
    fs.writeFileSync(path.join(repoDir, "ref.md"), "policy\n");
    git(["add", "."], repoDir);
    git(["commit", "--quiet", "-m", "seed"], repoDir);

    await expect(
      resolveReviewReferenceFromBase(
        "ref.md",
        "0000000000000000000000000000000000000000",
      ),
    ).rejects.toThrow(/git ls-tree failed for 'ref\.md'/);
  });

  it("rejects a directory path under base SHA as Invalid review-reference-file", async () => {
    fs.mkdirSync(path.join(repoDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "docs/inside.md"), "inside\n");
    git(["add", "."], repoDir);
    git(["commit", "--quiet", "-m", "directory"], repoDir);
    const baseSha = git(["rev-parse", "HEAD"], repoDir).trim();

    await expect(
      resolveReviewReferenceFromBase("docs", baseSha),
    ).rejects.toThrow(/unsupported git mode 040000 at base SHA/);
  });

  it("treats glob metacharacters in the path as literal (no pathspec interpretation)", async () => {
    const literalPath = "weird*name.md";
    const decoyPath = "weirdABCname.md";
    fs.writeFileSync(path.join(repoDir, literalPath), "LITERAL star\n");
    fs.writeFileSync(path.join(repoDir, decoyPath), "DECOY glob match\n");
    git(["add", "."], repoDir);
    git(["commit", "--quiet", "-m", "literal vs decoy"], repoDir);
    const baseSha = git(["rev-parse", "HEAD"], repoDir).trim();

    const result = await resolveReviewReferenceFromBase(literalPath, baseSha);
    expect(result).toBe("LITERAL star\n");
  });

  it("rejects an oversize tracked blob without buffering it into memory", async () => {
    const refPath = "huge.md";
    fs.writeFileSync(path.join(repoDir, refPath), "x".repeat(64 * 1024 + 1));
    git(["add", "."], repoDir);
    git(["commit", "--quiet", "-m", "oversize"], repoDir);
    const baseSha = git(["rev-parse", "HEAD"], repoDir).trim();

    await expect(
      resolveReviewReferenceFromBase(refPath, baseSha),
    ).rejects.toThrow(/exceeds \d+-byte limit/);
  });
});
