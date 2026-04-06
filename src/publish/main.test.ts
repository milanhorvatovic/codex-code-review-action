import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSetFailed = vi.fn();
const mockSetOutput = vi.fn();
const mockWarning = vi.fn();

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
  setOutput: (...args: unknown[]) => mockSetOutput(...args),
  setSecret: vi.fn(),
  warning: (...args: unknown[]) => mockWarning(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: () => true,
  readFileSync: () => JSON.stringify({
    changes: ["Added validation"],
    files: [{ description: "Main file", path: "src/main.ts" }],
    findings: [],
    model: "test-model",
    overall_confidence_score: 0.95,
    overall_correctness: "patch is correct",
    summary: "Test summary",
  }),
}));

const mockPublishReview = vi.fn();

vi.mock("../github/review.js", () => ({
  publishReview: (...args: unknown[]) => mockPublishReview(...args),
}));

vi.mock("../config/inputs.js", () => ({
  getPublishInputs: () => ({
    githubToken: "token",
    maxComments: Infinity,
    minConfidence: 0,
    model: "test-model",
    reviewEffort: "medium",
  }),
}));

describe("publish/main env var handling", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    mockSetFailed.mockReset();
    mockSetOutput.mockReset();
    mockWarning.mockReset();
    mockPublishReview.mockReset();

    process.env = { ...originalEnv };
    mockPublishReview.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("constructs full runUrl when env vars are present", async () => {
    process.env.GITHUB_SERVER_URL = "https://github.com";
    process.env.GITHUB_REPOSITORY = "owner/repo";
    process.env.GITHUB_RUN_ID = "12345";

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

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    const params = mockPublishReview.mock.calls[0][0] as Record<string, unknown>;
    expect(params.runUrl).toBe("");
  });

  it("passes empty runUrl when GITHUB_RUN_ID is missing", async () => {
    process.env.GITHUB_REPOSITORY = "owner/repo";
    delete process.env.GITHUB_RUN_ID;

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    const params = mockPublishReview.mock.calls[0][0] as Record<string, unknown>;
    expect(params.runUrl).toBe("");
  });

  it("passes empty runUrl when both env vars are empty strings", async () => {
    process.env.GITHUB_REPOSITORY = "";
    process.env.GITHUB_RUN_ID = "";

    await import("./main.js");
    await vi.waitFor(() => {
      expect(mockPublishReview).toHaveBeenCalled();
    });

    const params = mockPublishReview.mock.calls[0][0] as Record<string, unknown>;
    expect(params.runUrl).toBe("");
  });
});
