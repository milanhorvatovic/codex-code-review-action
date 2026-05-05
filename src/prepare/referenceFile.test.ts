import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  REFERENCE_MAX_BYTES,
  ReviewReferenceFileError,
  resolveReviewReferenceFromWorkspace,
  validateReviewReferencePath,
} from "./referenceFile.js";

const skipOnWindows = process.platform === "win32";

function isFilesystemCaseInsensitive(): boolean {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "case-probe-"));
  try {
    fs.writeFileSync(path.join(probeDir, "x"), "");
    return fs.existsSync(path.join(probeDir, "X"));
  } finally {
    fs.rmSync(probeDir, { force: true, recursive: true });
  }
}

const skipOnCaseSensitiveFs = !isFilesystemCaseInsensitive();

describe("validateReviewReferencePath", () => {
  it("returns the normalized path for a valid input", () => {
    expect(validateReviewReferencePath(".github/codex/review-reference.md")).toBe(
      ".github/codex/review-reference.md",
    );
  });

  it("strips a leading './' prefix", () => {
    expect(validateReviewReferencePath("./.github/codex/review-reference.md")).toBe(
      ".github/codex/review-reference.md",
    );
  });

  it("rejects an empty path", () => {
    expect(() => validateReviewReferencePath("")).toThrow(ReviewReferenceFileError);
  });

  it("rejects a whitespace-only path", () => {
    expect(() => validateReviewReferencePath("   ")).toThrow(/path is empty/);
  });

  it("rejects a NUL byte", () => {
    expect(() => validateReviewReferencePath("foo\0.md")).toThrow(/NUL byte/);
  });

  it("rejects a backslash", () => {
    expect(() => validateReviewReferencePath("foo\\bar.md")).toThrow(/backslash/);
  });

  it("rejects an absolute POSIX path", () => {
    expect(() => validateReviewReferencePath("/etc/passwd")).toThrow(
      /workspace-relative/,
    );
  });

  it("rejects a Windows-style absolute path", () => {
    expect(() => validateReviewReferencePath("C:/temp/reference.md")).toThrow(
      /workspace-relative/,
    );
  });

  it("rejects traversal", () => {
    expect(() => validateReviewReferencePath("../reference.md")).toThrow(
      /escapes the workspace/,
    );
  });

  it("rejects the workspace root", () => {
    expect(() => validateReviewReferencePath(".")).toThrow(/workspace root/);
  });

  it("rejects .git path with mixed casing", () => {
    expect(() => validateReviewReferencePath(".GIT/config")).toThrow(/\.git directory/);
  });
});

describe("resolveReviewReferenceFromWorkspace", () => {
  let workspace: string;
  let realWorkspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ref-"));
    realWorkspace = fs.realpathSync.native(workspace);
  });

  afterEach(() => {
    fs.rmSync(workspace, { force: true, recursive: true });
  });

  function writeFile(relative: string, content: string): string {
    const absolute = path.join(realWorkspace, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
    return absolute;
  }

  it("reads a workspace-relative file", () => {
    writeFile(".github/codex/review-reference.md", "hello\n");
    expect(
      resolveReviewReferenceFromWorkspace(".github/codex/review-reference.md", realWorkspace),
    ).toBe("hello\n");
  });

  it("normalizes a leading './' prefix", () => {
    writeFile(".github/codex/review-reference.md", "hi\n");
    expect(
      resolveReviewReferenceFromWorkspace("./.github/codex/review-reference.md", realWorkspace),
    ).toBe("hi\n");
  });

  it("rejects an empty path", () => {
    expect(() => resolveReviewReferenceFromWorkspace("", realWorkspace)).toThrow(
      ReviewReferenceFileError,
    );
  });

  it("rejects a whitespace-only path", () => {
    expect(() => resolveReviewReferenceFromWorkspace("   ", realWorkspace)).toThrow(
      /path is empty/,
    );
  });

  it("rejects a path containing a NUL byte", () => {
    expect(() =>
      resolveReviewReferenceFromWorkspace("foo\0.md", realWorkspace),
    ).toThrow(/NUL byte/);
  });

  it("rejects a path containing a backslash", () => {
    expect(() =>
      resolveReviewReferenceFromWorkspace("foo\\bar.md", realWorkspace),
    ).toThrow(/backslash/);
  });

  it("rejects an absolute POSIX path", () => {
    expect(() =>
      resolveReviewReferenceFromWorkspace("/proc/self/environ", realWorkspace),
    ).toThrow(/workspace-relative/);
  });

  it("rejects another absolute POSIX path", () => {
    expect(() =>
      resolveReviewReferenceFromWorkspace("/tmp/reference.md", realWorkspace),
    ).toThrow(/workspace-relative/);
  });

  it("rejects a Windows-style absolute path (drive letter, forward slashes)", () => {
    expect(() =>
      resolveReviewReferenceFromWorkspace("C:/temp/reference.md", realWorkspace),
    ).toThrow(/workspace-relative/);
  });

  it("rejects a path that escapes the workspace via '..'", () => {
    expect(() =>
      resolveReviewReferenceFromWorkspace("../reference.md", realWorkspace),
    ).toThrow(/escapes the workspace/);
  });

  it("rejects paths that target the .git directory", () => {
    expect(() =>
      resolveReviewReferenceFromWorkspace(".git/config", realWorkspace),
    ).toThrow(/\.git directory/);
  });

  it("rejects .git path with mixed casing", () => {
    expect(() =>
      resolveReviewReferenceFromWorkspace(".GIT/config", realWorkspace),
    ).toThrow(/\.git directory/);
  });

  it("rejects a path that normalizes to the workspace root", () => {
    expect(() => resolveReviewReferenceFromWorkspace(".", realWorkspace)).toThrow(
      /workspace root/,
    );
  });

  it("rejects a missing file with an actionable message", () => {
    expect(() =>
      resolveReviewReferenceFromWorkspace("missing.md", realWorkspace),
    ).toThrow(/file not found.*missing\.md/);
  });

  it("rejects a directory path", () => {
    fs.mkdirSync(path.join(realWorkspace, "docs"));
    expect(() => resolveReviewReferenceFromWorkspace("docs", realWorkspace)).toThrow(
      /not a regular file/,
    );
  });

  it.skipIf(skipOnWindows)("rejects a leaf symbolic link", () => {
    writeFile("real.md", "secret\n");
    fs.symlinkSync(
      path.join(realWorkspace, "real.md"),
      path.join(realWorkspace, "link.md"),
    );
    expect(() => resolveReviewReferenceFromWorkspace("link.md", realWorkspace)).toThrow(
      /symbolic link/,
    );
  });

  it.skipIf(skipOnWindows)("rejects a leaf symlink that targets outside the workspace", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.md"), "stolen\n");
      fs.symlinkSync(
        path.join(outside, "secret.md"),
        path.join(realWorkspace, "leak.md"),
      );
      expect(() =>
        resolveReviewReferenceFromWorkspace("leak.md", realWorkspace),
      ).toThrow(/symbolic link/);
    } finally {
      fs.rmSync(outside, { force: true, recursive: true });
    }
  });

  it.skipIf(skipOnWindows)("rejects an ancestor directory symbolic link", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    try {
      fs.mkdirSync(path.join(outside, "real"));
      fs.writeFileSync(path.join(outside, "real", "ref.md"), "stolen\n");
      fs.symlinkSync(
        path.join(outside, "real"),
        path.join(realWorkspace, "linked-dir"),
      );
      expect(() =>
        resolveReviewReferenceFromWorkspace("linked-dir/ref.md", realWorkspace),
      ).toThrow(/symbolic link|outside the workspace/);
    } finally {
      fs.rmSync(outside, { force: true, recursive: true });
    }
  });

  it("rejects a file larger than the byte cap", () => {
    writeFile("big.md", "x".repeat(REFERENCE_MAX_BYTES + 1));
    expect(() => resolveReviewReferenceFromWorkspace("big.md", realWorkspace)).toThrow(
      /exceeds \d+-byte limit/,
    );
  });

  it("accepts a file at exactly the byte cap", () => {
    writeFile("edge.md", "x".repeat(REFERENCE_MAX_BYTES));
    expect(
      resolveReviewReferenceFromWorkspace("edge.md", realWorkspace).length,
    ).toBe(REFERENCE_MAX_BYTES);
  });

  it.skipIf(skipOnCaseSensitiveFs)(
    "accepts a case-mismatched path on case-insensitive filesystems",
    () => {
      writeFile("review-reference.md", "case-insensitive\n");
      expect(
        resolveReviewReferenceFromWorkspace("REVIEW-REFERENCE.md", realWorkspace),
      ).toBe("case-insensitive\n");
    },
  );

  it.skipIf(skipOnWindows)("resolves correctly when the cwd argument is itself a symlink", () => {
    writeFile(".github/codex/review-reference.md", "via-symlink\n");
    const linkCwd = path.join(os.tmpdir(), `ref-link-${process.pid}-${Date.now()}`);
    fs.symlinkSync(realWorkspace, linkCwd);
    try {
      expect(
        resolveReviewReferenceFromWorkspace(
          ".github/codex/review-reference.md",
          linkCwd,
        ),
      ).toBe("via-symlink\n");
    } finally {
      fs.rmSync(linkCwd, { force: true });
    }
  });

  it("rejects when the workspace directory itself does not exist", () => {
    const missing = path.join(os.tmpdir(), `missing-cwd-${process.pid}-${Date.now()}`);
    expect(() =>
      resolveReviewReferenceFromWorkspace(".github/codex/review-reference.md", missing),
    ).toThrow(/workspace directory .* is not accessible/);
  });

  it("error class carries the expected name", () => {
    try {
      resolveReviewReferenceFromWorkspace("/etc/passwd", realWorkspace);
      expect.fail("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewReferenceFileError);
      expect((error as Error).name).toBe("ReviewReferenceFileError");
    }
  });
});
