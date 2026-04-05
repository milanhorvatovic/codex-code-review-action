import * as core from "@actions/core";

import type { PublishInputs, ReviewInputs } from "./types.js";

const MAX_CHUNK_BYTES_DEFAULT = 204800;

export function getReviewInputs(): ReviewInputs {
  const apiKey = core.getInput("openai-api-key", { required: true });
  core.setSecret(apiKey);

  const rawMaxChunkBytes = Number(core.getInput("max-chunk-bytes"));
  const maxChunkBytes =
    Number.isInteger(rawMaxChunkBytes) && rawMaxChunkBytes > 0
      ? rawMaxChunkBytes
      : MAX_CHUNK_BYTES_DEFAULT;

  const githubToken = core.getInput("github-token");
  if (githubToken) {
    core.setSecret(githubToken);
  }

  return {
    allowedUsers: core.getInput("allowed-users"),
    apiKey,
    githubToken,
    maxChunkBytes,
    model: core.getInput("model"),
    retainFindings: core.getBooleanInput("retain-findings"),
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

  const rawMaxComments = Number(core.getInput("max-comments"));
  const maxComments =
    Number.isInteger(rawMaxComments) && rawMaxComments > 0
      ? rawMaxComments
      : Infinity;

  return {
    githubToken,
    maxComments,
    minConfidence,
    model: core.getInput("model"),
    reviewEffort: core.getInput("review-effort"),
  };
}
