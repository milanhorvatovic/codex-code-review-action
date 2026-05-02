import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  REFERENCE_MAX_BYTES,
  ReviewReferenceFileError,
  resolveReviewReferenceContent,
} from "./referenceFile.js";

const skipOnWindows = process.platform === "win32";

describe("resolveReviewReferenceContent", () => {
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
      resolveReviewReferenceContent(".github/codex/review-reference.md", realWorkspace),
    ).toBe("hello\n");
  });

  it("normalizes a leading './' prefix", () => {
    writeFile(".github/codex/review-reference.md", "hi\n");
    expect(
      resolveReviewReferenceContent("./.github/codex/review-reference.md", realWorkspace),
    ).toBe("hi\n");
  });

  it("rejects an empty path", () => {
    expect(() => resolveReviewReferenceContent("", realWorkspace)).toThrow(
      ReviewReferenceFileError,
    );
  });

  it("rejects a whitespace-only path", () => {
    expect(() => resolveReviewReferenceContent("   ", realWorkspace)).toThrow(
      /path is empty/,
    );
  });

  it("rejects a path containing a NUL byte", () => {
    expect(() =>
      resolveReviewReferenceContent("foo\0.md", realWorkspace),
    ).toThrow(/NUL byte/);
  });

  it("rejects a path containing a backslash", () => {
    expect(() =>
      resolveReviewReferenceContent("foo\\bar.md", realWorkspace),
    ).toThrow(/backslash/);
  });

  it("rejects an absolute POSIX path", () => {
    expect(() =>
      resolveReviewReferenceContent("/proc/self/environ", realWorkspace),
    ).toThrow(/workspace-relative/);
  });

  it("rejects another absolute POSIX path", () => {
    expect(() =>
      resolveReviewReferenceContent("/tmp/reference.md", realWorkspace),
    ).toThrow(/workspace-relative/);
  });

  it("rejects a Windows-style absolute path (drive letter, forward slashes)", () => {
    expect(() =>
      resolveReviewReferenceContent("C:/temp/reference.md", realWorkspace),
    ).toThrow(/workspace-relative/);
  });

  it("rejects a path that escapes the workspace via '..'", () => {
    expect(() =>
      resolveReviewReferenceContent("../reference.md", realWorkspace),
    ).toThrow(/escapes the workspace/);
  });

  it("rejects a path that normalizes to the workspace root", () => {
    expect(() => resolveReviewReferenceContent(".", realWorkspace)).toThrow(
      /workspace root/,
    );
  });

  it("rejects a missing file with an actionable message", () => {
    expect(() =>
      resolveReviewReferenceContent("missing.md", realWorkspace),
    ).toThrow(/file not found.*missing\.md/);
  });

  it("rejects a directory path", () => {
    fs.mkdirSync(path.join(realWorkspace, "docs"));
    expect(() => resolveReviewReferenceContent("docs", realWorkspace)).toThrow(
      /not a regular file/,
    );
  });

  it.skipIf(skipOnWindows)("rejects a leaf symbolic link", () => {
    writeFile("real.md", "secret\n");
    fs.symlinkSync(
      path.join(realWorkspace, "real.md"),
      path.join(realWorkspace, "link.md"),
    );
    expect(() => resolveReviewReferenceContent("link.md", realWorkspace)).toThrow(
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
        resolveReviewReferenceContent("leak.md", realWorkspace),
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
        resolveReviewReferenceContent("linked-dir/ref.md", realWorkspace),
      ).toThrow(/symbolic link|outside the workspace/);
    } finally {
      fs.rmSync(outside, { force: true, recursive: true });
    }
  });

  it("rejects a file larger than the byte cap", () => {
    writeFile("big.md", "x".repeat(REFERENCE_MAX_BYTES + 1));
    expect(() => resolveReviewReferenceContent("big.md", realWorkspace)).toThrow(
      /exceeds \d+-byte limit/,
    );
  });

  it("accepts a file at exactly the byte cap", () => {
    writeFile("edge.md", "x".repeat(REFERENCE_MAX_BYTES));
    expect(
      resolveReviewReferenceContent("edge.md", realWorkspace).length,
    ).toBe(REFERENCE_MAX_BYTES);
  });

  it.skipIf(process.platform === "linux")(
    "accepts a case-mismatched path on case-insensitive filesystems",
    () => {
      writeFile("review-reference.md", "case-insensitive\n");
      expect(
        resolveReviewReferenceContent("REVIEW-REFERENCE.md", realWorkspace),
      ).toBe("case-insensitive\n");
    },
  );

  it.skipIf(skipOnWindows)("resolves correctly when the cwd argument is itself a symlink", () => {
    writeFile(".github/codex/review-reference.md", "via-symlink\n");
    const linkCwd = path.join(os.tmpdir(), `ref-link-${process.pid}-${Date.now()}`);
    fs.symlinkSync(realWorkspace, linkCwd);
    try {
      expect(
        resolveReviewReferenceContent(
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
      resolveReviewReferenceContent(".github/codex/review-reference.md", missing),
    ).toThrow(/workspace directory .* is not accessible/);
  });

  it("error class carries the expected name", () => {
    try {
      resolveReviewReferenceContent("/etc/passwd", realWorkspace);
      expect.fail("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewReferenceFileError);
      expect((error as Error).name).toBe("ReviewReferenceFileError");
    }
  });
});
