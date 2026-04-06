import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSetFailed = vi.fn();
const mockSetOutput = vi.fn();
const mockStartGroup = vi.fn();
const mockEndGroup = vi.fn();
const mockInfo = vi.fn();

vi.mock("@actions/core", () => ({
  endGroup: (...args: unknown[]) => mockEndGroup(...args),
  info: (...args: unknown[]) => mockInfo(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
  setOutput: (...args: unknown[]) => mockSetOutput(...args),
  setSecret: vi.fn(),
  startGroup: (...args: unknown[]) => mockStartGroup(...args),
}));

const mockWriteFileSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: () => false,
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

vi.mock("node:path", () => ({
  resolve: (p: string) => p,
}));

const mockFetchBaseSha = vi.fn();
const mockBuildDiff = vi.fn();

vi.mock("../github/git.js", () => ({
  buildDiff: (...args: unknown[]) => mockBuildDiff(...args),
  fetchBaseSha: (...args: unknown[]) => mockFetchBaseSha(...args),
}));

const mockSplitDiff = vi.fn();

vi.mock("../core/diff.js", () => ({
  buildChunkMatrix: (n: number) => JSON.stringify({ chunk: Array.from({ length: n }, (_, i) => i) }),
  splitDiff: (...args: unknown[]) => mockSplitDiff(...args),
}));

vi.mock("../core/prompt.js", () => ({
  assemblePrompt: () => "test prompt",
}));

vi.mock("../config/defaults.js", () => ({
  defaultPrompt: "prompt",
  defaultReference: "reference",
  defaultSchema: { type: "object" },
}));

const mockGetPrepareInputs = vi.fn();
const mockGetPullRequestContext = vi.fn();

vi.mock("../config/inputs.js", () => ({
  getPrepareInputs: () => mockGetPrepareInputs(),
}));

vi.mock("../github/context.js", () => ({
  getPullRequestContext: () => mockGetPullRequestContext(),
}));

vi.mock("../core/allowlist.js", () => ({
  isAuthorAllowed: () => true,
}));

const defaultInputs = {
  allowedUsers: "*",
  githubToken: "token",
  maxChunkBytes: 200000,
  reviewReferenceFile: "",
};

const defaultContext = {
  author: "testuser",
  baseSha: "base123",
  body: "PR body",
  headSha: "head456",
  isDraft: false,
  number: 1,
  title: "Test PR",
};

describe("prepare/main error handling", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSetFailed.mockReset();
    mockSetOutput.mockReset();
    mockStartGroup.mockReset();
    mockEndGroup.mockReset();
    mockInfo.mockReset();
    mockWriteFileSync.mockReset();
    mockFetchBaseSha.mockReset();
    mockBuildDiff.mockReset();
    mockSplitDiff.mockReset();
    mockGetPrepareInputs.mockReset();
    mockGetPullRequestContext.mockReset();

    mockGetPrepareInputs.mockReturnValue(defaultInputs);
    mockGetPullRequestContext.mockReturnValue(defaultContext);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls setFailed when fetchBaseSha throws", async () => {
    mockFetchBaseSha.mockRejectedValueOnce(new Error("network timeout"));

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetFailed).toHaveBeenCalled();
    });

    expect(mockSetFailed).toHaveBeenCalledWith(
      "Failed to build PR diff: network timeout",
    );
  });

  it("calls setFailed when buildDiff throws", async () => {
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockRejectedValueOnce(new Error("git error"));

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetFailed).toHaveBeenCalled();
    });

    expect(mockSetFailed).toHaveBeenCalledWith(
      "Failed to build PR diff: git error",
    );
  });

  it("calls setFailed when splitDiff throws", async () => {
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("diff content");
    mockSplitDiff.mockImplementationOnce(() => {
      throw new Error("split failed");
    });

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetFailed).toHaveBeenCalled();
    });

    expect(mockSetFailed).toHaveBeenCalledWith(
      "Failed to split diff: split failed",
    );
  });

  it("writes prompt files for each chunk", async () => {
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("diff content");
    mockSplitDiff.mockReturnValueOnce(["chunk0", "chunk1"]);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    const writeCalls = mockWriteFileSync.mock.calls.map((c) => c[0]);
    expect(writeCalls).toContain(".codex/pr.diff");
    expect(writeCalls).toContain(".codex/chunk-0-prompt.md");
    expect(writeCalls).toContain(".codex/chunk-1-prompt.md");
    expect(writeCalls).toContain(".codex/review-output-schema.json");
  });

  it("sets outputs for empty diff", async () => {
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("");

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetOutput).toHaveBeenCalledWith("has-changes", "false");
    });

    expect(mockSetOutput).toHaveBeenCalledWith("chunk-count", "0");
  });

  it("sets chunk-count and chunk-matrix outputs", async () => {
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("diff content");
    mockSplitDiff.mockReturnValueOnce(["chunk0", "chunk1", "chunk2"]);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetOutput).toHaveBeenCalledWith("chunk-count", "3");
    });

    expect(mockSetOutput).toHaveBeenCalledWith("has-changes", "true");
  });
});
