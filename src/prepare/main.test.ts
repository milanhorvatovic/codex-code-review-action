import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewReferenceFileError } from "./referenceFile.js";

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
  mkdirSync: vi.fn(),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

const mockResolveReviewReferenceContent = vi.fn();

vi.mock("./referenceFile.js", async () => {
  const actual = await vi.importActual<typeof import("./referenceFile.js")>(
    "./referenceFile.js",
  );
  return {
    ...actual,
    resolveReviewReferenceContent: (...args: unknown[]) =>
      mockResolveReviewReferenceContent(...args),
  };
});

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

const mockAssemblePrompt = vi.fn();

vi.mock("../core/prompt.js", () => ({
  assemblePrompt: (...args: unknown[]) => mockAssemblePrompt(...args),
}));

vi.mock("../config/defaults.js", () => ({
  defaultPrompt: "prompt",
  defaultReference: "default-reference",
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
    mockAssemblePrompt.mockReset();
    mockResolveReviewReferenceContent.mockReset();
    mockGetPrepareInputs.mockReset();
    mockGetPullRequestContext.mockReset();

    mockGetPrepareInputs.mockReturnValue(defaultInputs);
    mockGetPullRequestContext.mockReturnValue(defaultContext);
    mockAssemblePrompt.mockReturnValue("test prompt");
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

  it("uses the default reference when no review-reference-file input is set", async () => {
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("diff content");
    mockSplitDiff.mockReturnValueOnce(["chunk0"]);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockAssemblePrompt).toHaveBeenCalled();
    });

    expect(mockResolveReviewReferenceContent).not.toHaveBeenCalled();
    expect(mockAssemblePrompt.mock.calls[0]?.[0]).toMatchObject({
      reference: "default-reference",
    });
  });

  it("uses the resolved custom reference content for each prompt", async () => {
    mockGetPrepareInputs.mockReturnValue({
      ...defaultInputs,
      reviewReferenceFile: ".github/codex/review-reference.md",
    });
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("diff content");
    mockSplitDiff.mockReturnValueOnce(["chunk0", "chunk1"]);
    mockResolveReviewReferenceContent.mockReturnValueOnce("custom-reference");

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockAssemblePrompt).toHaveBeenCalledTimes(2);
    });

    expect(mockResolveReviewReferenceContent).toHaveBeenCalledWith(
      ".github/codex/review-reference.md",
      expect.any(String),
    );
    for (const call of mockAssemblePrompt.mock.calls) {
      expect(call[0]).toMatchObject({ reference: "custom-reference" });
    }
  });

  it("calls setFailed when the reference resolver rejects the input", async () => {
    mockGetPrepareInputs.mockReturnValue({
      ...defaultInputs,
      reviewReferenceFile: "/etc/passwd",
    });
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("diff content");
    mockSplitDiff.mockReturnValueOnce(["chunk0"]);
    mockResolveReviewReferenceContent.mockImplementationOnce(() => {
      throw new ReviewReferenceFileError(
        "path '/etc/passwd' must be workspace-relative, not absolute",
      );
    });

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetFailed).toHaveBeenCalled();
    });

    expect(mockSetFailed).toHaveBeenCalledWith(
      "Invalid review-reference-file: path '/etc/passwd' must be workspace-relative, not absolute",
    );
    expect(mockAssemblePrompt).not.toHaveBeenCalled();
  });

  it("re-throws non-ReviewReferenceFileError exceptions from the resolver", async () => {
    mockGetPrepareInputs.mockReturnValue({
      ...defaultInputs,
      reviewReferenceFile: "ref.md",
    });
    mockFetchBaseSha.mockResolvedValueOnce(undefined);
    mockBuildDiff.mockResolvedValueOnce("diff content");
    mockSplitDiff.mockReturnValueOnce(["chunk0"]);
    mockResolveReviewReferenceContent.mockImplementationOnce(() => {
      throw new Error("unexpected boom");
    });

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetFailed).toHaveBeenCalled();
    });

    expect(mockSetFailed).toHaveBeenCalledWith("unexpected boom");
  });
});
