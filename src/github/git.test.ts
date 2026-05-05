import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@actions/exec", () => ({
  getExecOutput: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  setSecret: vi.fn(),
}));

import { getExecOutput } from "@actions/exec";

import { buildDiff, fetchBaseSha, readPathAtSha } from "./git.js";

const mockGetExecOutput = vi.mocked(getExecOutput);

function getFetchArgs(callIndex: number): string[] {
  const args = mockGetExecOutput.mock.calls[callIndex][1];
  if (!args) {
    throw new Error(`Expected args at call index ${callIndex} to be defined`);
  }
  return args;
}

beforeEach(() => {
  mockGetExecOutput.mockReset();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchBaseSha", () => {
  it("skips fetch when commit already exists locally", async () => {
    mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    await fetchBaseSha("abc123", "token");

    expect(mockGetExecOutput).toHaveBeenCalledTimes(1);
    expect(mockGetExecOutput).toHaveBeenCalledWith(
      "git",
      ["cat-file", "-e", "abc123^{commit}"],
      { ignoreReturnCode: true, silent: true },
    );
  });

  it("fetches with --deepen=50 when repository is shallow", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({ exitCode: 1, stderr: "", stdout: "" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "true\n" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    await fetchBaseSha("abc123", "");

    expect(mockGetExecOutput).toHaveBeenCalledTimes(3);

    const fetchArgs = getFetchArgs(2);
    expect(fetchArgs).toContain("--deepen=50");
    expect(fetchArgs).not.toContain("--depth=50");
  });

  it("fetches with --depth=50 when repository is not shallow", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({ exitCode: 1, stderr: "", stdout: "" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "false\n" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    await fetchBaseSha("abc123", "");

    const fetchArgs = getFetchArgs(2);
    expect(fetchArgs).toContain("--depth=50");
    expect(fetchArgs).not.toContain("--deepen=50");
  });

  it("includes auth header when token is provided", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({ exitCode: 1, stderr: "", stdout: "" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "false\n" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    await fetchBaseSha("abc123", "my-token");

    const fetchArgs = getFetchArgs(2);
    expect(fetchArgs).toContain("-c");

    const configArg = fetchArgs.find((arg) =>
      arg.startsWith("http.") && arg.includes(".extraheader="),
    );
    expect(configArg).toBeDefined();
    expect(configArg).toContain("AUTHORIZATION: basic");
  });

  it("uses GITHUB_SERVER_URL for auth host when set", async () => {
    vi.stubEnv("GITHUB_SERVER_URL", "https://custom.github.example.com");

    mockGetExecOutput
      .mockResolvedValueOnce({ exitCode: 1, stderr: "", stdout: "" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "false\n" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    await fetchBaseSha("abc123", "my-token");

    const fetchArgs = getFetchArgs(2);
    const configArg = fetchArgs.find((arg) =>
      arg.startsWith("http.") && arg.includes(".extraheader="),
    );
    expect(configArg).toMatch(/^http\.https:\/\/custom\.github\.example\.com/);
  });

  it("omits auth args when token is empty", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({ exitCode: 1, stderr: "", stdout: "" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "false\n" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    await fetchBaseSha("abc123", "");

    const fetchArgs = getFetchArgs(2);
    expect(fetchArgs).not.toContain("-c");
    expect(fetchArgs).toEqual([
      "fetch",
      "--no-tags",
      "--depth=50",
      "origin",
      "abc123",
    ]);
  });

  it("always passes --no-tags and origin", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({ exitCode: 1, stderr: "", stdout: "" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "true\n" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    await fetchBaseSha("sha-xyz", "");

    const fetchArgs = getFetchArgs(2);
    expect(fetchArgs).toContain("--no-tags");
    expect(fetchArgs).toContain("origin");
    expect(fetchArgs).toContain("sha-xyz");
  });
});

describe("buildDiff", () => {
  it("returns the stdout of git diff", async () => {
    mockGetExecOutput.mockResolvedValueOnce({
      exitCode: 0,
      stderr: "",
      stdout: "diff --git a/file.ts b/file.ts\n+hello\n",
    });

    const result = await buildDiff("base-sha", "head-sha");

    expect(result).toBe("diff --git a/file.ts b/file.ts\n+hello\n");
    expect(mockGetExecOutput).toHaveBeenCalledWith(
      "git",
      ["diff", "--no-color", "--unified=3", "base-sha...head-sha"],
      { silent: true },
    );
  });

  it("returns empty string when diff is empty", async () => {
    mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    const result = await buildDiff("same-sha", "same-sha");

    expect(result).toBe("");
  });
});

describe("readPathAtSha", () => {
  it("returns blob content and file mode for a tracked file", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout:
          "100644 blob abcdef1234567890abcdef1234567890abcdef12\t.github/codex/review-reference.md\0",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout: "policy content\n",
      });

    const result = await readPathAtSha("base-sha", ".github/codex/review-reference.md");

    expect(result).toEqual({ content: "policy content\n", mode: "100644" });
    expect(mockGetExecOutput).toHaveBeenNthCalledWith(
      1,
      "git",
      [
        "ls-tree",
        "-z",
        "--full-tree",
        "base-sha",
        "--",
        ".github/codex/review-reference.md",
      ],
      { ignoreReturnCode: true, silent: true },
    );
    expect(mockGetExecOutput).toHaveBeenNthCalledWith(
      2,
      "git",
      ["cat-file", "blob", "abcdef1234567890abcdef1234567890abcdef12"],
      { ignoreReturnCode: true, silent: true },
    );
  });

  it("returns mode 120000 for a tracked symbolic link", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout:
          "120000 blob 0000000000000000000000000000000000000001\tlinked.md\0",
      })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "../target" });

    const result = await readPathAtSha("base-sha", "linked.md");

    expect(result.mode).toBe("120000");
  });

  it("throws when the path is absent at the SHA (empty ls-tree output)", async () => {
    mockGetExecOutput.mockResolvedValueOnce({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });

    await expect(readPathAtSha("base-sha", "missing.md")).rejects.toThrow(
      /'missing\.md' does not exist at base-sha/,
    );
    expect(mockGetExecOutput).toHaveBeenCalledTimes(1);
  });

  it("throws when ls-tree itself fails (e.g. unknown SHA)", async () => {
    mockGetExecOutput.mockResolvedValueOnce({
      exitCode: 128,
      stderr: "fatal: not a valid object name unknown-sha",
      stdout: "",
    });

    await expect(readPathAtSha("unknown-sha", "ref.md")).rejects.toThrow(
      /git ls-tree failed for 'ref\.md' at unknown-sha: fatal: not a valid object name/,
    );
    expect(mockGetExecOutput).toHaveBeenCalledTimes(1);
  });

  it("rejects a tree entry (directory at the path)", async () => {
    mockGetExecOutput.mockResolvedValueOnce({
      exitCode: 0,
      stderr: "",
      stdout:
        "040000 tree 0000000000000000000000000000000000000002\tdocs\0",
    });

    await expect(readPathAtSha("base-sha", "docs")).rejects.toThrow(
      /'docs' at base-sha is a tree, not a file/,
    );
  });

  it("propagates cat-file failure with stderr context", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout:
          "100644 blob deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\tref.md\0",
      })
      .mockResolvedValueOnce({
        exitCode: 128,
        stderr: "fatal: Not a valid object name deadbeef",
        stdout: "",
      });

    await expect(readPathAtSha("base-sha", "ref.md")).rejects.toThrow(
      /git cat-file failed for blob deadbeefdeadbeefdeadbeefdeadbeefdeadbeef/,
    );
  });
});
