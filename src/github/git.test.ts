import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@actions/exec", () => ({
  getExecOutput: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  setSecret: vi.fn(),
}));

import { getExecOutput } from "@actions/exec";

import { buildDiff, fetchBaseSha } from "./git.js";

const mockGetExecOutput = vi.mocked(getExecOutput);

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

    const fetchCall = mockGetExecOutput.mock.calls[2];
    expect(fetchCall[1]).toContain("--deepen=50");
    expect(fetchCall[1]).not.toContain("--depth=50");
  });

  it("fetches with --depth=50 when repository is not shallow", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({ exitCode: 1, stderr: "", stdout: "" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "false\n" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    await fetchBaseSha("abc123", "");

    const fetchCall = mockGetExecOutput.mock.calls[2];
    expect(fetchCall[1]).toContain("--depth=50");
    expect(fetchCall[1]).not.toContain("--deepen=50");
  });

  it("includes auth header when token is provided", async () => {
    mockGetExecOutput
      .mockResolvedValueOnce({ exitCode: 1, stderr: "", stdout: "" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "false\n" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "", stdout: "" });

    await fetchBaseSha("abc123", "my-token");

    const fetchArgs = mockGetExecOutput.mock.calls[2][1] as string[];
    expect(fetchArgs).toContain("-c");

    const configArg = fetchArgs.find((arg: string) =>
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

    const fetchArgs = mockGetExecOutput.mock.calls[2][1] as string[];
    const configArg = fetchArgs.find((arg: string) =>
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

    const fetchArgs = mockGetExecOutput.mock.calls[2][1] as string[];
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

    const fetchArgs = mockGetExecOutput.mock.calls[2][1] as string[];
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
