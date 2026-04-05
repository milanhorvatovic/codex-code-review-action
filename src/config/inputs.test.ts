import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  getBooleanInput: vi.fn(),
  getInput: vi.fn(),
  setSecret: vi.fn(),
}));

import * as core from "@actions/core";

import { getPublishInputs, getReviewInputs } from "./inputs.js";

const mockGetInput = vi.mocked(core.getInput);
const mockGetBooleanInput = vi.mocked(core.getBooleanInput);
const mockSetSecret = vi.mocked(core.setSecret);

afterEach(() => {
  vi.clearAllMocks();
});

describe("getReviewInputs", () => {
  it("parses all inputs correctly", () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        "allowed-users": "user1,user2",
        "github-token": "ghp-token",
        "max-chunk-bytes": "100000",
        "model": "o4-mini",
        "openai-api-key": "sk-test-key",
        "review-reference-file": ".github/codex/reference.md",
      };
      return inputs[name] ?? "";
    });
    mockGetBooleanInput.mockReturnValue(false);

    const result = getReviewInputs();

    expect(result.apiKey).toBe("sk-test-key");
    expect(result.githubToken).toBe("ghp-token");
    expect(result.model).toBe("o4-mini");
    expect(result.allowedUsers).toBe("user1,user2");
    expect(result.maxChunkBytes).toBe(100000);
    expect(result.retainFindings).toBe(false);
    expect(result.reviewReferenceFile).toBe(".github/codex/reference.md");
  });

  it("masks the API key", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "openai-api-key" ? "sk-secret" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    getReviewInputs();

    expect(mockSetSecret).toHaveBeenCalledWith("sk-secret");
  });

  it("uses default max-chunk-bytes for invalid input", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "openai-api-key" ? "key" : name === "max-chunk-bytes" ? "invalid" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    const result = getReviewInputs();
    expect(result.maxChunkBytes).toBe(204800);
  });

  it("uses default max-chunk-bytes for negative value", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "openai-api-key" ? "key" : name === "max-chunk-bytes" ? "-100" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    const result = getReviewInputs();
    expect(result.maxChunkBytes).toBe(204800);
  });
});

describe("getPublishInputs", () => {
  it("parses all inputs correctly", () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        "github-token": "ghp-test",
        "max-comments": "10",
        "min-confidence": "0.5",
        "model": "o4-mini",
        "review-effort": "high",
      };
      return inputs[name] ?? "";
    });

    const result = getPublishInputs();

    expect(result.githubToken).toBe("ghp-test");
    expect(result.model).toBe("o4-mini");
    expect(result.reviewEffort).toBe("high");
    expect(result.minConfidence).toBe(0.5);
    expect(result.maxComments).toBe(10);
  });

  it("masks the GitHub token", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "ghp-secret" : "",
    );

    getPublishInputs();

    expect(mockSetSecret).toHaveBeenCalledWith("ghp-secret");
  });

  it("clamps min-confidence to 0-1 range", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "min-confidence" ? "2.5" : "",
    );

    const result = getPublishInputs();
    expect(result.minConfidence).toBe(1);
  });

  it("defaults min-confidence to 0 for invalid input", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "min-confidence" ? "invalid" : "",
    );

    const result = getPublishInputs();
    expect(result.minConfidence).toBe(0);
  });

  it("defaults max-comments to Infinity when empty", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : "",
    );

    const result = getPublishInputs();
    expect(result.maxComments).toBe(Infinity);
  });
});
