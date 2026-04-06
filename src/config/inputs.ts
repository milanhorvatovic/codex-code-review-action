import * as core from "@actions/core";

import type { PrepareInputs, PublishInputs } from "./types.js";

const MAX_CHUNK_BYTES_DEFAULT = 204800;
const RETAIN_FINDINGS_DAYS_DEFAULT = 90;
const RETAIN_FINDINGS_DAYS_MAX = 90;

export function getPrepareInputs(): PrepareInputs {
  const githubToken = core.getInput("github-token");
  if (githubToken) {
    core.setSecret(githubToken);
  }

  const rawMaxChunkBytes = Number(core.getInput("max-chunk-bytes"));
  const maxChunkBytes =
    Number.isInteger(rawMaxChunkBytes) && rawMaxChunkBytes > 0
      ? rawMaxChunkBytes
      : MAX_CHUNK_BYTES_DEFAULT;

  return {
    allowedUsers: core.getInput("allowed-users"),
    githubToken,
    maxChunkBytes,
    reviewReferenceFile: core.getInput("review-reference-file"),
  };
}

export function getPublishInputs(): PublishInputs {
  const githubToken = core.getInput("github-token", { required: true });
  core.setSecret(githubToken);

  const rawMinConfidence = Number(core.getInput("min-confidence"));
  const minConfidence = Number.isFinite(rawMinConfidence)
    ? Math.min(1, Math.max(0, rawMinConfidence))
    : 0;

  const maxCommentsInput = core.getInput("max-comments").trim();
  let maxComments = Infinity;
  if (maxCommentsInput !== "") {
    const parsed = Number(maxCommentsInput);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error("Input 'max-comments' must be a non-negative integer or empty for unlimited.");
    }
    maxComments = parsed;
  }

  const expectedChunksInput = core.getInput("expected-chunks").trim();
  let expectedChunks: number | null = null;
  if (expectedChunksInput !== "") {
    const parsed = Number(expectedChunksInput);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error("Input 'expected-chunks' must be a non-negative integer or empty to skip validation.");
    }
    expectedChunks = parsed;
  }

  const retainFindings = core.getBooleanInput("retain-findings");
  let retainFindingsDays = RETAIN_FINDINGS_DAYS_DEFAULT;
  const retainDaysInput = core.getInput("retain-findings-days").trim();
  if (retainFindings && retainDaysInput !== "") {
    const parsed = Number(retainDaysInput);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Input 'retain-findings-days' must be a positive integer (got '${retainDaysInput}').`);
    }
    retainFindingsDays = Math.min(RETAIN_FINDINGS_DAYS_MAX, parsed);
    if (retainFindingsDays !== parsed) {
      core.warning(`Input 'retain-findings-days' was clamped from ${parsed} to ${retainFindingsDays} (maximum: ${RETAIN_FINDINGS_DAYS_MAX}).`);
    }
  }

  return {
    expectedChunks,
    githubToken,
    maxComments,
    minConfidence,
    model: core.getInput("model"),
    retainFindings,
    retainFindingsDays,
    reviewEffort: core.getInput("review-effort"),
  };
}
