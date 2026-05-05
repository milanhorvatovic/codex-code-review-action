import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewOutput } from "../config/types.js";

const mockCreateReview = vi.fn();
const mockPaginate = vi.fn();

vi.mock("@actions/github", () => ({
  context: {
    payload: {
      pull_request: {
        head: { sha: "abc123" },
        number: 42,
        user: { login: "testuser" },
      },
    },
    repo: { owner: "test-owner", repo: "test-repo" },
  },
  getOctokit: () => ({
    paginate: mockPaginate,
    rest: {
      pulls: {
        createReview: mockCreateReview,
        listReviewComments: "listReviewComments",
        listReviews: "listReviews",
      },
    },
  }),
}));

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import { publishReview } from "./review.js";

const validReviewOutput: ReviewOutput = {
  changes: ["Added validation"],
  effort: null,
  files: [{ description: "Main file", path: "src/main.ts" }],
  findings: [
    {
      body: "This is broken",
      confidence_score: 0.9,
      line: 10,
      path: "src/main.ts",
      priority: 1,
      reasoning: "Because it is",
      start_line: null,
      suggestion: null,
      title: "Bug found",
    },
  ],
  model: "test-model",
  overall_confidence_score: 0.85,
  overall_correctness: "patch is incorrect",
  summary: "Found issues",
};

const diffWithAddedLine = [
  "diff --git a/src/main.ts b/src/main.ts",
  "--- a/src/main.ts",
  "+++ b/src/main.ts",
  "@@ -1,3 +1,4 @@",
  " line1",
  " line2",
  " line3",
  " line4",
  " line5",
  " line6",
  " line7",
  " line8",
  " line9",
  "+added line at 10",
  " line11",
].join("\n");

const chunkDefaults = {
  expectedChunks: null as number | null,
  missingChunks: [] as number[],
};

beforeEach(() => {
  mockCreateReview.mockReset();
  mockPaginate.mockReset();
  mockPaginate.mockResolvedValue([]);
});

describe("publishReview", () => {
  it("publishes a review successfully", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    const result = await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      model: "test-model",
      reviewEffort: "medium",
      reviewOutput: validReviewOutput,
      runUrl: "https://example.com/run/1",
    });

    expect(mockCreateReview).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("publishes review with no findings", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      model: "",
      reviewEffort: "",
      reviewOutput: { ...validReviewOutput, findings: [] },
      runUrl: "https://example.com/run/1",
    });

    expect(mockCreateReview).toHaveBeenCalledTimes(1);
    const call = mockCreateReview.mock.calls[0][0] as Record<string, unknown>;
    expect(call.comments).toBeUndefined();
  });

  it("filters findings below confidence threshold", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0.95,
      model: "",
      reviewEffort: "",
      reviewOutput: validReviewOutput,
      runUrl: "https://example.com/run/1",
    });

    const call = mockCreateReview.mock.calls[0][0] as Record<string, unknown>;
    expect(call.comments).toBeUndefined();
  });

  it("retries without inline comments on failure", async () => {
    mockCreateReview
      .mockRejectedValueOnce(new Error("inline failed"))
      .mockResolvedValueOnce({});

    const result = await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      model: "",
      reviewEffort: "",
      reviewOutput: validReviewOutput,
      runUrl: "https://example.com/run/1",
    });

    expect(mockCreateReview).toHaveBeenCalledTimes(2);
    expect(result).toBe(true);
  });

  it("limits comments when maxComments is set", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    const manyFindings = Array.from({ length: 10 }, (_, i) => ({
      body: `Issue ${i}`,
      confidence_score: 0.9,
      line: 10,
      path: "src/main.ts",
      priority: 1,
      reasoning: `Reason ${i}`,
      start_line: null,
      suggestion: null,
      title: `Bug ${i}`,
    }));

    await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: 2,
      minConfidence: 0,
      model: "",
      reviewEffort: "",
      reviewOutput: { ...validReviewOutput, findings: manyFindings },
      runUrl: "https://example.com/run/1",
    });

    const call = mockCreateReview.mock.calls[0][0] as Record<string, unknown>;
    const comments = call.comments as unknown[];
    expect(comments?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("handles empty diff text", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    await publishReview({
      ...chunkDefaults,
      diffText: "",
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      model: "",
      reviewEffort: "",
      reviewOutput: validReviewOutput,
      runUrl: "https://example.com/run/1",
    });

    expect(mockCreateReview).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate findings based on existing bot markers", async () => {
    mockCreateReview.mockResolvedValueOnce({});
    mockPaginate
      .mockResolvedValueOnce([
        {
          body: "<!-- codex-inline:0000000000000000 -->",
          user: { type: "Bot" },
        },
      ])
      .mockResolvedValue([]);

    await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      model: "",
      reviewEffort: "",
      reviewOutput: validReviewOutput,
      runUrl: "https://example.com/run/1",
    });

    expect(mockCreateReview).toHaveBeenCalledTimes(1);
  });

  it("detects subsequent review and uses shorter body", async () => {
    mockCreateReview.mockResolvedValueOnce({});
    mockPaginate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          body: "<!-- codex-pr-review -->\n\nPrevious review",
          user: { type: "Bot" },
        },
      ]);

    await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      model: "",
      reviewEffort: "",
      reviewOutput: validReviewOutput,
      runUrl: "https://example.com/run/1",
    });

    expect(mockCreateReview).toHaveBeenCalledTimes(1);
  });

  it("returns false when all publish attempts fail", async () => {
    mockCreateReview
      .mockRejectedValueOnce(new Error("first fail"))
      .mockRejectedValueOnce(new Error("second fail"));

    const result = await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      model: "",
      reviewEffort: "",
      reviewOutput: validReviewOutput,
      runUrl: "https://example.com/run/1",
    });

    expect(mockCreateReview).toHaveBeenCalledTimes(2);
    expect(result).toBe(false);
  });

  it("(p-warn) fallback unparseable-response branch + missing chunks renders WARNING banner before raw block", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    const invalidFinding = {
      body: "x",
      confidence_score: 0.9,
      line: 0,
      path: "",
      priority: 1,
      reasoning: "",
      start_line: null,
      suggestion: null,
      title: "",
    };

    await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      expectedChunks: 3,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      missingChunks: [2],
      model: "",
      reviewEffort: "",
      reviewOutput: { ...validReviewOutput, findings: [invalidFinding] },
      runUrl: "https://example.com/run/1",
    });

    const call = mockCreateReview.mock.calls[0][0] as Record<string, unknown>;
    const body = call.body as string;
    expect(body).toContain("> [!WARNING]\n> **Incomplete review**");
    const bannerIdx = body.indexOf("[!WARNING]");
    const couldNotParseIdx = body.indexOf("Could not parse structured Codex output");
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(couldNotParseIdx).toBeGreaterThan(bannerIdx);
  });

  it("(q) fallback path with no missing chunks renders no banner (regression guard)", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    const invalidFinding = {
      body: "x",
      confidence_score: 0.9,
      line: 0,
      path: "",
      priority: 1,
      reasoning: "",
      start_line: null,
      suggestion: null,
      title: "",
    };

    await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      model: "",
      reviewEffort: "",
      reviewOutput: { ...validReviewOutput, findings: [invalidFinding] },
      runUrl: "https://example.com/run/1",
    });

    const call = mockCreateReview.mock.calls[0][0] as Record<string, unknown>;
    const body = call.body as string;
    expect(body).toContain("Could not parse structured Codex output");
    expect(body).not.toContain("Incomplete review");
    expect(body).not.toContain("[!WARNING]");
    expect(body).not.toContain("[!CAUTION]");
  });

  it("publishes with correct verdict", async () => {
    mockCreateReview.mockResolvedValueOnce({});

    await publishReview({
      ...chunkDefaults,
      diffText: diffWithAddedLine,
      githubToken: "token",
      maxComments: Infinity,
      minConfidence: 0,
      model: "test-model",
      reviewEffort: "high",
      reviewOutput: {
        ...validReviewOutput,
        overall_correctness: "patch is correct",
        overall_confidence_score: 0.95,
      },
      runUrl: "https://example.com/run/1",
    });

    const call = mockCreateReview.mock.calls[0][0] as Record<string, unknown>;
    const body = call.body as string;
    expect(body).toContain("Patch is correct");
    expect(body).toContain("confidence: 0.95");
  });
});
