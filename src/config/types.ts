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
