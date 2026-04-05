export type Verdict = "patch is correct" | "patch is incorrect";

export interface Finding {
  body: string;
  confidence_score: number;
  line: number;
  path: string;
  priority: number;
  reasoning: string;
  start_line: number | null;
  suggestion: string | null;
  title: string;
}

export interface ReviewFile {
  description: string;
  path: string;
}

export interface ReviewOutput {
  changes: string[];
  files: ReviewFile[];
  findings: Finding[];
  model: string;
  overall_confidence_score: number;
  overall_correctness: Verdict;
  summary: string;
}

export interface NormalizedFinding {
  body: string;
  confidenceScore: number;
  line: number;
  path: string;
  priority: number;
  reasoning: string;
  startLine: number | null;
  suggestion: string | null;
  title: string;
}

export interface ReviewInputs {
  allowedUsers: string;
  apiKey: string;
  githubToken: string;
  maxChunkBytes: number;
  model: string;
  retainFindings: boolean;
  reviewReferenceFile: string;
}

export interface PublishInputs {
  githubToken: string;
  maxComments: number;
  minConfidence: number;
  model: string;
  reviewEffort: string;
}

export interface PrContext {
  author: string;
  baseSha: string;
  body: string;
  headSha: string;
  isDraft: boolean;
  number: number;
  title: string;
}

export function isReviewOutput(value: unknown): value is ReviewOutput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.summary === "string" &&
    Array.isArray(obj.findings) &&
    Array.isArray(obj.changes) &&
    Array.isArray(obj.files) &&
    typeof obj.model === "string" &&
    (obj.overall_correctness === "patch is correct" ||
      obj.overall_correctness === "patch is incorrect") &&
    typeof obj.overall_confidence_score === "number" &&
    Number.isFinite(obj.overall_confidence_score)
  );
}
