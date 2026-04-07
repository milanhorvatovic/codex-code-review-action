import * as fs from "node:fs";

import * as artifact from "@actions/artifact";
import * as core from "@actions/core";

import { getPublishInputs } from "../config/inputs.js";
import { isReviewOutput } from "../config/types.js";
import type { ReviewOutput } from "../config/types.js";
import { mergeChunkReviews } from "../core/merge.js";
import { publishReview } from "../github/review.js";

const CODEX_DIR = ".codex";
const REVIEW_OUTPUT_FILE = `${CODEX_DIR}/review-output.json`;
const DIFF_FILE = `${CODEX_DIR}/pr.diff`;
const ARTIFACT_NAME = "codex-review-findings";

const CHUNK_OUTPUT_PATTERN = /^chunk-(\d+)-output\.json$/;

interface ChunkEntry {
  index: number;
  path: string;
}

function discoverChunkFiles(): ChunkEntry[] {
  if (!fs.existsSync(CODEX_DIR)) {
    return [];
  }

  return fs.readdirSync(CODEX_DIR)
    .map((name: string) => {
      const match = CHUNK_OUTPUT_PATTERN.exec(name);
      if (!match) return null;
      return { index: Number(match[1]), path: `${CODEX_DIR}/${name}` };
    })
    .filter((entry: ChunkEntry | null): entry is ChunkEntry => entry !== null)
    .sort((a: ChunkEntry, b: ChunkEntry) => a.index - b.index);
}

function parseChunkFile(filePath: string): ReviewOutput | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    core.warning(`Failed to read chunk file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    core.warning(`Chunk file is not valid JSON: ${filePath}`);
    return null;
  }
  if (!isReviewOutput(parsed)) {
    core.warning(`Chunk file does not match ReviewOutput shape: ${filePath}`);
    return null;
  }
  return parsed;
}

async function run(): Promise<void> {
  const inputs = getPublishInputs();

  core.startGroup("Discovering and merging chunk reviews");
  let reviewOutput: ReviewOutput;
  try {
    const chunkFiles = discoverChunkFiles();

    if (chunkFiles.length === 0) {
      core.setFailed(
        `No chunk review outputs found in ${CODEX_DIR}/. Ensure the review step ran successfully and artifacts were downloaded.`,
      );
      return;
    }

    const chunkResults: ReviewOutput[] = [];
    for (const chunk of chunkFiles) {
      const result = parseChunkFile(chunk.path);
      if (result) {
        chunkResults.push(result);
        core.info(`Parsed chunk ${chunk.index}: ${result.findings.length} finding(s)`);
      }
    }

    if (chunkResults.length === 0) {
      core.setFailed("All chunk review outputs failed validation. Cannot publish review.");
      return;
    }

    if (inputs.expectedChunks !== null && chunkResults.length < inputs.expectedChunks) {
      const missing = inputs.expectedChunks - chunkResults.length;
      const invalid = chunkFiles.length - chunkResults.length;
      const parts = [`Expected ${inputs.expectedChunks} chunk(s) but merged ${chunkResults.length}.`];
      if (invalid > 0) {
        parts.push(`${invalid} chunk(s) failed validation.`);
      }
      if (missing - invalid > 0) {
        parts.push(`${missing - invalid} chunk(s) were not produced.`);
      }
      parts.push("Proceeding with partial review.");
      core.warning(parts.join(" "));
    }

    reviewOutput = mergeChunkReviews(chunkResults);
    fs.writeFileSync(REVIEW_OUTPUT_FILE, JSON.stringify(reviewOutput, null, 2));
    core.info(`Merged ${chunkResults.length} chunk(s): ${reviewOutput.findings.length} finding(s) -> ${REVIEW_OUTPUT_FILE}`);
  } catch (error) {
    core.setFailed(
      `Failed to merge chunk reviews: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  } finally {
    core.endGroup();
  }

  core.setOutput("review-file", REVIEW_OUTPUT_FILE);
  core.setOutput("findings-count", String(reviewOutput.findings.length));
  core.setOutput("verdict", reviewOutput.overall_correctness);

  let diffText = "";
  if (fs.existsSync(DIFF_FILE)) {
    diffText = fs.readFileSync(DIFF_FILE, "utf8");
  } else {
    core.warning(`Diff file not found at ${DIFF_FILE}. Inline comments will be skipped because findings cannot be matched to changed lines.`);
  }

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY || "";
  const runId = process.env.GITHUB_RUN_ID || "";
  const runUrl =
    repository && runId
      ? `${serverUrl}/${repository}/actions/runs/${runId}`
      : "";

  const model = reviewOutput.model && reviewOutput.model !== "unknown"
    ? reviewOutput.model
    : inputs.model;

  const effort = reviewOutput.effort || inputs.reviewEffort;

  let published = false;
  try {
    published = await publishReview({
      diffText,
      githubToken: inputs.githubToken,
      maxComments: inputs.maxComments,
      minConfidence: inputs.minConfidence,
      model,
      reviewEffort: effort,
      reviewOutput,
      runUrl,
    });
  } catch (error) {
    core.setFailed(
      `Failed to publish review: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  core.setOutput("published", String(published));

  if (inputs.retainFindings) {
    core.startGroup("Uploading review findings artifact");
    try {
      const artifactFiles = [REVIEW_OUTPUT_FILE];
      if (fs.existsSync(DIFF_FILE)) {
        artifactFiles.push(DIFF_FILE);
      }
      const client = new artifact.DefaultArtifactClient();
      await client.uploadArtifact(
        ARTIFACT_NAME,
        artifactFiles,
        CODEX_DIR,
        { retentionDays: inputs.retainFindingsDays },
      );
      core.info(`Uploaded findings artifact: ${ARTIFACT_NAME}`);
    } catch (error) {
      core.warning(
        `Failed to upload findings artifact "${ARTIFACT_NAME}": ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      core.endGroup();
    }
  }

  if (!published) {
    core.setFailed("Failed to publish review. See warnings above for details.");
  }
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
