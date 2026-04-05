import * as fs from "node:fs";

import * as core from "@actions/core";

import { getPublishInputs } from "../config/inputs.js";
import { isReviewOutput } from "../config/types.js";
import type { ReviewOutput } from "../config/types.js";
import { publishReview } from "../github/review.js";

const REVIEW_OUTPUT_FILE = ".codex/review-output.json";
const DIFF_FILE = ".codex/pr.diff";

async function run(): Promise<void> {
  const inputs = getPublishInputs();

  if (!fs.existsSync(REVIEW_OUTPUT_FILE)) {
    core.setFailed(
      "Merged review output is missing. Did the review action run and upload artifacts?",
    );
    return;
  }

  const rawReview = fs.readFileSync(REVIEW_OUTPUT_FILE, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawReview);
  } catch {
    core.setFailed("Merged review output is not valid JSON.");
    return;
  }
  if (!isReviewOutput(parsed)) {
    core.setFailed("Merged review output does not match the expected ReviewOutput shape.");
    return;
  }
  const reviewOutput: ReviewOutput = parsed;

  core.setOutput("review-file", REVIEW_OUTPUT_FILE);

  const diffText = fs.existsSync(DIFF_FILE)
    ? fs.readFileSync(DIFF_FILE, "utf8")
    : "";

  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? ""}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`;

  const published = await publishReview({
    diffText,
    githubToken: inputs.githubToken,
    maxComments: inputs.maxComments,
    minConfidence: inputs.minConfidence,
    model: inputs.model,
    reviewEffort: inputs.reviewEffort,
    reviewOutput,
    runUrl,
  });

  core.setOutput("published", String(published));
  if (!published) {
    core.setFailed("Failed to publish review. See warnings above for details.");
  }
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
