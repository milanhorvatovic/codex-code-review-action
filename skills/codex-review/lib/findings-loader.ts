export type Finding = {
  body: string;
  confidence_score: number;
  line: number;
  path: string;
  priority: number;
  reasoning: string;
  start_line: number | null;
  suggestion: string | null;
  title: string;
};

export type Findings = {
  changes: ReadonlyArray<string>;
  effort: string | null;
  files: ReadonlyArray<{ description: string; path: string }>;
  findings: ReadonlyArray<Finding>;
  model: string;
  overall_confidence_score: number;
  overall_correctness: "patch is correct" | "patch is incorrect";
  summary: string;
};

export class FindingsValidationError extends Error {
  override name = "FindingsValidationError";
}

const REQUIRED_TOP_LEVEL = [
  "changes",
  "effort",
  "files",
  "findings",
  "model",
  "overall_confidence_score",
  "overall_correctness",
  "summary",
] as const;

const REQUIRED_FINDING_FIELDS = [
  "body",
  "confidence_score",
  "line",
  "path",
  "priority",
  "reasoning",
  "start_line",
  "suggestion",
  "title",
] as const;

export function parseFindings(jsonText: string): Findings {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FindingsValidationError(`findings JSON is not valid JSON: ${message}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new FindingsValidationError("findings root must be an object");
  }
  const obj = raw as Record<string, unknown>;
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in obj)) throw new FindingsValidationError(`missing top-level field: ${key}`);
  }
  if (!Array.isArray(obj["findings"])) throw new FindingsValidationError("findings must be an array");
  for (const [i, finding] of (obj["findings"] as ReadonlyArray<unknown>).entries()) {
    if (typeof finding !== "object" || finding === null) {
      throw new FindingsValidationError(`findings[${i}] must be an object`);
    }
    const f = finding as Record<string, unknown>;
    for (const key of REQUIRED_FINDING_FIELDS) {
      if (!(key in f)) throw new FindingsValidationError(`findings[${i}] missing field: ${key}`);
    }
    const conf = f["confidence_score"];
    if (typeof conf !== "number" || conf < 0 || conf > 1) {
      throw new FindingsValidationError(`findings[${i}].confidence_score out of range`);
    }
    const priority = f["priority"];
    if (typeof priority !== "number" || priority < 0 || priority > 3) {
      throw new FindingsValidationError(`findings[${i}].priority out of range`);
    }
  }
  const verdict = obj["overall_correctness"];
  if (verdict !== "patch is correct" && verdict !== "patch is incorrect") {
    throw new FindingsValidationError("overall_correctness must be 'patch is correct' or 'patch is incorrect'");
  }
  const overallConf = obj["overall_confidence_score"];
  if (typeof overallConf !== "number" || overallConf < 0 || overallConf > 1) {
    throw new FindingsValidationError("overall_confidence_score out of range");
  }
  return raw as Findings;
}
