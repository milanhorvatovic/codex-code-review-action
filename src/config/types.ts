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
  effort: string | null;
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

export type ReviewReferenceSource = "workspace" | "base";

export interface PrepareInputs {
  allowedUsers: string;
  githubToken: string;
  maxChunkBytes: number;
  reviewReferenceFile: string;
  reviewReferenceSource: ReviewReferenceSource;
}

export interface PublishInputs {
  expectedChunks: number | null;
  failOnMissingChunks: boolean;
  githubToken: string;
  maxComments: number;
  minConfidence: number;
  model: string;
  retainFindings: boolean;
  retainFindingsDays: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReviewFile(value: unknown): value is ReviewFile {
  return (
    isRecord(value) &&
    typeof value.description === "string" &&
    typeof value.path === "string"
  );
}

function isFinding(value: unknown): value is Finding {
  return (
    isRecord(value) &&
    typeof value.body === "string" &&
    typeof value.confidence_score === "number" &&
    Number.isFinite(value.confidence_score) &&
    typeof value.line === "number" &&
    Number.isFinite(value.line) &&
    typeof value.path === "string" &&
    typeof value.priority === "number" &&
    Number.isFinite(value.priority) &&
    typeof value.reasoning === "string" &&
    (value.start_line === null ||
      (typeof value.start_line === "number" && Number.isFinite(value.start_line))) &&
    (value.suggestion === null || typeof value.suggestion === "string") &&
    typeof value.title === "string"
  );
}

export function isReviewOutput(value: unknown): value is ReviewOutput {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.summary === "string" &&
    (value.effort === null || typeof value.effort === "string") &&
    Array.isArray(value.findings) &&
    value.findings.every(isFinding) &&
    Array.isArray(value.changes) &&
    value.changes.every((c) => typeof c === "string") &&
    Array.isArray(value.files) &&
    value.files.every(isReviewFile) &&
    typeof value.model === "string" &&
    (value.overall_correctness === "patch is correct" ||
      value.overall_correctness === "patch is incorrect") &&
    typeof value.overall_confidence_score === "number" &&
    Number.isFinite(value.overall_confidence_score)
  );
}
