import type { ReviewOutput } from "../config/types.js";

export function mergeChunkReviews(
  chunks: ReviewOutput[],
  expectedCount?: number,
): ReviewOutput {
  if (chunks.length === 0) {
    throw new Error("No valid chunk outputs to merge");
  }

  if (expectedCount !== undefined && chunks.length !== expectedCount) {
    throw new Error(
      `Chunk count mismatch: expected ${expectedCount}, got ${chunks.length}`,
    );
  }

  const summaries: string[] = [];
  const changes: string[] = [];
  const changesSet = new Set<string>();
  const files: ReviewOutput["files"] = [];
  const filesSet = new Set<string>();
  const findings: ReviewOutput["findings"] = [];
  let worstVerdict: ReviewOutput["overall_correctness"] = "patch is correct";
  let lowestConfidence = Infinity;
  let effort: string | null = null;
  let model = "unknown";

  for (const chunk of chunks) {
    summaries.push(chunk.summary);

    for (const change of chunk.changes) {
      if (!changesSet.has(change)) {
        changesSet.add(change);
        changes.push(change);
      }
    }

    for (const file of chunk.files) {
      if (!filesSet.has(file.path)) {
        filesSet.add(file.path);
        files.push(file);
      }
    }

    findings.push(...chunk.findings);

    if (chunk.overall_correctness === "patch is incorrect") {
      worstVerdict = "patch is incorrect";
    }

    if (chunk.overall_confidence_score < lowestConfidence) {
      lowestConfidence = chunk.overall_confidence_score;
    }

    if (effort === null && chunk.effort !== null) {
      effort = chunk.effort;
    }

    if (model === "unknown" && chunk.model !== "") {
      model = chunk.model;
    }
  }

  return {
    changes,
    effort,
    files,
    findings,
    model,
    overall_confidence_score: lowestConfidence,
    overall_correctness: worstVerdict,
    summary: summaries.join(" "),
  };
}
