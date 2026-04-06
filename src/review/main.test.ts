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

vi.mock("node:fs", () => ({
  existsSync: () => false,
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
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

const mockReviewChunk = vi.fn();

vi.mock("../openai/client.js", () => ({
  createOpenAIClient: () => ({}),
  reviewChunk: (...args: unknown[]) => mockReviewChunk(...args),
}));

const mockMergeChunkReviews = vi.fn();

vi.mock("../core/merge.js", () => ({
  mergeChunkReviews: (...args: unknown[]) => mockMergeChunkReviews(...args),
}));

vi.mock("../core/prompt.js", () => ({
  assemblePrompt: () => "test prompt",
}));

vi.mock("../config/defaults.js", () => ({
  defaultPrompt: "prompt",
  defaultReference: "reference",
  defaultSchema: {},
}));

vi.mock("@actions/artifact", () => ({
  DefaultArtifactClient: class {
    uploadArtifact = vi.fn().mockResolvedValue({});
  },
}));

const mockGetReviewInputs = vi.fn();
const mockGetPullRequestContext = vi.fn();

vi.mock("../config/inputs.js", () => ({
  getReviewInputs: () => mockGetReviewInputs(),
}));

vi.mock("../github/context.js", () => ({
  getPullRequestContext: () => mockGetPullRequestContext(),
}));

vi.mock("../core/allowlist.js", () => ({
  isAuthorAllowed: () => true,
}));

const defaultInputs = {
  allowedUsers: "*",
  apiKey: "test-key",
  githubToken: "token",
  maxChunkBytes: 200000,
  model: "test-model",
  retainFindings: false,
  retainFindingsDays: 90,
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

const validReviewOutput = {
  changes: ["Added validation"],
  files: [{ description: "Main file", path: "src/main.ts" }],
  findings: [],
  model: "test-model",
  overall_confidence_score: 0.95,
  overall_correctness: "patch is correct",
  summary: "Test summary",
};

describe("review/main error handling", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSetFailed.mockReset();
    mockSetOutput.mockReset();
    mockStartGroup.mockReset();
    mockEndGroup.mockReset();
    mockInfo.mockReset();
    mockFetchBaseSha.mockReset();
    mockBuildDiff.mockReset();
    mockSplitDiff.mockReset();
    mockReviewChunk.mockReset();
    mockMergeChunkReviews.mockReset();
    mockGetReviewInputs.mockReset();
    mockGetPullRequestContext.mockReset();

    mockGetReviewInputs.mockReturnValue(defaultInputs);
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

  it("calls setFailed with chunk index when reviewChunk throws", async () => {
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("diff content");
    mockSplitDiff.mockReturnValueOnce(["chunk0", "chunk1", "chunk2"]);
    mockReviewChunk
      .mockResolvedValueOnce(validReviewOutput)
      .mockRejectedValueOnce(new Error("API rate limit"));

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetFailed).toHaveBeenCalled();
    });

    expect(mockSetFailed).toHaveBeenCalledWith(
      "Chunk 1 review failed: API rate limit",
    );
  });

  it("calls setFailed when mergeChunkReviews throws", async () => {
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("diff content");
    mockSplitDiff.mockReturnValueOnce(["chunk0"]);
    mockReviewChunk.mockResolvedValueOnce(validReviewOutput);
    mockMergeChunkReviews.mockImplementationOnce(() => {
      throw new Error("merge conflict");
    });

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetFailed).toHaveBeenCalled();
    });

    expect(mockSetFailed).toHaveBeenCalledWith(
      "Failed to merge chunk reviews: merge conflict",
    );
  });
});
