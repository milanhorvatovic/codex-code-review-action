import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  getBooleanInput: vi.fn(),
  getInput: vi.fn(),
  setSecret: vi.fn(),
  warning: vi.fn(),
}));

import * as core from "@actions/core";

import { getPrepareInputs, getPublishInputs } from "./inputs.js";

const mockGetInput = vi.mocked(core.getInput);
const mockGetBooleanInput = vi.mocked(core.getBooleanInput);
const mockSetSecret = vi.mocked(core.setSecret);
const mockWarning = vi.mocked(core.warning);

afterEach(() => {
  vi.clearAllMocks();
});

describe("getPrepareInputs", () => {
  it("parses all inputs correctly", () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        "allowed-users": "user1,user2",
        "github-token": "ghp-token",
        "max-chunk-bytes": "100000",
        "review-reference-file": ".github/codex/reference.md",
      };
      return inputs[name] ?? "";
    });

    const result = getPrepareInputs();

    expect(result.githubToken).toBe("ghp-token");
    expect(result.allowedUsers).toBe("user1,user2");
    expect(result.maxChunkBytes).toBe(100000);
    expect(result.reviewReferenceFile).toBe(".github/codex/reference.md");
  });

  it("masks the GitHub token", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "ghp-secret" : "",
    );

    getPrepareInputs();

    expect(mockSetSecret).toHaveBeenCalledWith("ghp-secret");
  });

  it("uses default max-chunk-bytes for invalid input", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "max-chunk-bytes" ? "invalid" : "",
    );

    const result = getPrepareInputs();
    expect(result.maxChunkBytes).toBe(204800);
  });

  it("uses default max-chunk-bytes for negative value", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "max-chunk-bytes" ? "-100" : "",
    );

    const result = getPrepareInputs();
    expect(result.maxChunkBytes).toBe(204800);
  });
});

describe("getPublishInputs", () => {
  it("parses all inputs correctly", () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        "expected-chunks": "3",
        "github-token": "ghp-test",
        "max-comments": "10",
        "min-confidence": "0.5",
        "model": "o4-mini",
        "retain-findings-days": "30",
        "review-effort": "high",
      };
      return inputs[name] ?? "";
    });
    mockGetBooleanInput.mockReturnValue(true);

    const result = getPublishInputs();

    expect(result.expectedChunks).toBe(3);
    expect(result.githubToken).toBe("ghp-test");
    expect(result.maxComments).toBe(10);
    expect(result.minConfidence).toBe(0.5);
    expect(result.model).toBe("o4-mini");
    expect(result.retainFindings).toBe(true);
    expect(result.retainFindingsDays).toBe(30);
    expect(result.reviewEffort).toBe("high");
  });

  it("masks the GitHub token", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "ghp-secret" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    getPublishInputs();

    expect(mockSetSecret).toHaveBeenCalledWith("ghp-secret");
  });

  it("clamps min-confidence to 0-1 range", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "min-confidence" ? "2.5" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    const result = getPublishInputs();
    expect(result.minConfidence).toBe(1);
  });

  it("defaults min-confidence to 0 for invalid input", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "min-confidence" ? "invalid" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    const result = getPublishInputs();
    expect(result.minConfidence).toBe(0);
  });

  it("defaults max-comments to Infinity when empty", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    const result = getPublishInputs();
    expect(result.maxComments).toBe(Infinity);
  });

  it("allows max-comments of 0", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "max-comments" ? "0" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    const result = getPublishInputs();
    expect(result.maxComments).toBe(0);
  });

  it("throws for negative max-comments", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "max-comments" ? "-1" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    expect(() => getPublishInputs()).toThrow("non-negative integer");
  });

  it("throws for non-integer max-comments", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "max-comments" ? "abc" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    expect(() => getPublishInputs()).toThrow("non-negative integer");
  });

  it("defaults expected-chunks to null when empty", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    const result = getPublishInputs();
    expect(result.expectedChunks).toBeNull();
  });

  it("parses expected-chunks as integer", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "expected-chunks" ? "5" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    const result = getPublishInputs();
    expect(result.expectedChunks).toBe(5);
  });

  it("throws for negative expected-chunks", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "expected-chunks" ? "-1" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    expect(() => getPublishInputs()).toThrow("non-negative integer");
  });

  it("throws for non-integer retain-findings-days when retain-findings is enabled", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "retain-findings-days" ? "invalid" : "",
    );
    mockGetBooleanInput.mockReturnValue(true);

    expect(() => getPublishInputs()).toThrow("must be a positive integer");
  });

  it("clamps retain-findings-days exceeding 90 and warns", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "retain-findings-days" ? "365" : "",
    );
    mockGetBooleanInput.mockReturnValue(true);

    const result = getPublishInputs();
    expect(result.retainFindingsDays).toBe(90);
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("clamped from 365 to 90"),
    );
  });

  it("skips retain-findings-days validation when retain-findings is disabled", () => {
    mockGetInput.mockImplementation((name: string) =>
      name === "github-token" ? "token" : name === "retain-findings-days" ? "invalid" : "",
    );
    mockGetBooleanInput.mockReturnValue(false);

    const result = getPublishInputs();
    expect(result.retainFindingsDays).toBe(90);
  });
});
