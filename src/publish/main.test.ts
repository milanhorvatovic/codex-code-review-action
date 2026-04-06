import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSetFailed = vi.fn();
const mockSetOutput = vi.fn();
const mockWarning = vi.fn();
const mockInfo = vi.fn();
const mockStartGroup = vi.fn();
const mockEndGroup = vi.fn();

vi.mock("@actions/core", () => ({
  endGroup: (...args: unknown[]) => mockEndGroup(...args),
  info: (...args: unknown[]) => mockInfo(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
  setOutput: (...args: unknown[]) => mockSetOutput(...args),
  setSecret: vi.fn(),
  startGroup: (...args: unknown[]) => mockStartGroup(...args),
  warning: (...args: unknown[]) => mockWarning(...args),
}));

vi.mock("@actions/artifact", () => ({
  DefaultArtifactClient: class {
    uploadArtifact = vi.fn().mockResolvedValue({});
  },
}));

const validReview = JSON.stringify({
  changes: ["Added validation"],
  effort: null,
  files: [{ description: "Main file", path: "src/main.ts" }],
  findings: [],
  model: "test-model",
  overall_confidence_score: 0.95,
  overall_correctness: "patch is correct",
  summary: "Test summary",
});

const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

const mockPublishReview = vi.fn();

vi.mock("../github/review.js", () => ({
  publishReview: (...args: unknown[]) => mockPublishReview(...args),
}));

vi.mock("../core/merge.js", () => ({
  mergeChunkReviews: (chunks: unknown[]) => {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new Error("No valid chunk outputs to merge");
    }
    return chunks[0];
  },
}));

vi.mock("../config/inputs.js", () => ({
  getPublishInputs: () => ({
    expectedChunks: null,
    githubToken: "token",
    maxComments: Infinity,
    minConfidence: 0,
    model: "fallback-model",
    retainFindings: false,
    retainFindingsDays: 90,
    reviewEffort: "medium",
  }),
}));

describe("publish/main", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    mockSetFailed.mockReset();
    mockSetOutput.mockReset();
    mockWarning.mockReset();
    mockInfo.mockReset();
    mockStartGroup.mockReset();
    mockEndGroup.mockReset();
    mockExistsSync.mockReset();
    mockReaddirSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockPublishReview.mockReset();

    process.env = { ...originalEnv };
    mockPublishReview.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("discovers and merges chunk files", async () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === ".codex" || p === ".codex/pr.diff",
    );
    mockReaddirSync.mockReturnValue(["chunk-0-output.json", "chunk-1-output.json"]);
    mockReadFileSync.mockReturnValue(validReview);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    expect(mockSetOutput).toHaveBeenCalledWith("findings-count", "0");
    expect(mockSetOutput).toHaveBeenCalledWith("verdict", "patch is correct");
  });

  it("fails when no chunk files found", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetFailed).toHaveBeenCalled();
    });

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("No chunk review outputs found"),
    );
  });

  it("fails when .codex directory does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockSetFailed).toHaveBeenCalled();
    });

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("No chunk review outputs found"),
    );
  });

  it("warns about missing chunks with partial failure tolerance", async () => {
    vi.resetModules();
    vi.doMock("../config/inputs.js", () => ({
      getPublishInputs: () => ({
        expectedChunks: 3,
        githubToken: "token",
        maxComments: Infinity,
        minConfidence: 0,
        model: "",
        retainFindings: false,
        retainFindingsDays: 90,
        reviewEffort: "",
      }),
    }));

    mockExistsSync.mockImplementation((p: string) =>
      p === ".codex" || p === ".codex/pr.diff",
    );
    mockReaddirSync.mockReturnValue(["chunk-0-output.json"]);
    mockReadFileSync.mockReturnValue(validReview);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("Expected 3 chunk(s) but found 1"),
    );
  });

  it("skips invalid chunk files and merges valid ones", async () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === ".codex" || p === ".codex/pr.diff",
    );
    mockReaddirSync.mockReturnValue(["chunk-0-output.json", "chunk-1-output.json"]);
    mockReadFileSync.mockImplementation((p: string) => {
      if (typeof p === "string" && p.includes("chunk-1")) return "not json";
      return validReview;
    });

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("not valid JSON"),
    );
  });

  it("constructs full runUrl when env vars are present", async () => {
    process.env.GITHUB_SERVER_URL = "https://github.com";
    process.env.GITHUB_REPOSITORY = "owner/repo";
    process.env.GITHUB_RUN_ID = "12345";

    mockExistsSync.mockImplementation((p: string) =>
      p === ".codex" || p === ".codex/pr.diff",
    );
    mockReaddirSync.mockReturnValue(["chunk-0-output.json"]);
    mockReadFileSync.mockReturnValue(validReview);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    const params = mockPublishReview.mock.calls[0][0] as Record<string, unknown>;
    expect(params.runUrl).toBe("https://github.com/owner/repo/actions/runs/12345");
  });

  it("passes empty runUrl when GITHUB_REPOSITORY is missing", async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_RUN_ID;

    mockExistsSync.mockImplementation((p: string) =>
      p === ".codex" || p === ".codex/pr.diff",
    );
    mockReaddirSync.mockReturnValue(["chunk-0-output.json"]);
    mockReadFileSync.mockReturnValue(validReview);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    const params = mockPublishReview.mock.calls[0][0] as Record<string, unknown>;
    expect(params.runUrl).toBe("");
  });

  it("uses model from review output over input fallback", async () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === ".codex" || p === ".codex/pr.diff",
    );
    mockReaddirSync.mockReturnValue(["chunk-0-output.json"]);
    mockReadFileSync.mockReturnValue(validReview);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    const params = mockPublishReview.mock.calls[0][0] as Record<string, unknown>;
    expect(params.model).toBe("test-model");
  });

  it("ignores non-chunk files in .codex directory", async () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === ".codex" || p === ".codex/pr.diff",
    );
    mockReaddirSync.mockReturnValue([
      "pr.diff",
      "chunk-0-prompt.md",
      "chunk-0-output.json",
      "review-output-schema.json",
    ]);
    mockReadFileSync.mockReturnValue(validReview);

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("Parsed chunk 0"),
    );
  });
});
