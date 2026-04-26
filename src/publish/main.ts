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
  } catch (error) {
    core.warning(`Chunk file is not valid JSON: ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
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

  if (inputs.expectedChunks === 0) {
    core.info("Expected 0 chunks — nothing to publish.");
    core.setOutput("published", "false");
    core.setOutput("findings-count", "0");
    core.setOutput("verdict", "");
    core.setOutput("review-file", "");
    return;
  }

  core.startGroup("Discovering and merging chunk reviews");
  let reviewOutput: ReviewOutput;
  let missingIndices: number[] = [];
  try {
    const chunkFiles = discoverChunkFiles();

    if (chunkFiles.length === 0) {
      core.setFailed(
        `No chunk review outputs found in ${CODEX_DIR}. Ensure the review step ran successfully and artifacts were downloaded.`,
      );
      return;
    }

    const chunkResults: ReviewOutput[] = [];
    const mergedIndices = new Set<number>();
    for (const chunk of chunkFiles) {
      const result = parseChunkFile(chunk.path);
      if (result) {
        chunkResults.push(result);
        mergedIndices.add(chunk.index);
        core.info(`Parsed chunk ${chunk.index}: ${result.findings.length} finding(s)`);
      }
    }

    if (chunkResults.length === 0) {
      core.setFailed("All chunk review outputs failed validation. Cannot publish review.");
      return;
    }

    if (inputs.expectedChunks !== null) {
      for (let i = 0; i < inputs.expectedChunks; i++) {
        if (!mergedIndices.has(i)) {
          missingIndices.push(i);
        }
      }

      if (missingIndices.length > 0) {
        const parts = [`Expected ${inputs.expectedChunks} chunk(s) but merged ${chunkResults.length}.`];
        parts.push(`Missing chunk(s): ${missingIndices.join(", ")}.`);
        parts.push("Publishing partial review with incomplete banner.");
        core.warning(parts.join(" "));
      }
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

  const effort = reviewOutput.effort?.trim() || inputs.reviewEffort.trim();

  let published = false;
  let publishError: string | null = null;
  try {
    published = await publishReview({
      diffText,
      expectedChunks: inputs.expectedChunks,
      failOnMissingChunks: inputs.failOnMissingChunks,
      githubToken: inputs.githubToken,
      maxComments: inputs.maxComments,
      minConfidence: inputs.minConfidence,
      missingChunks: missingIndices,
      model,
      reviewEffort: effort,
      reviewOutput,
      runUrl,
    });
  } catch (error) {
    publishError = `Failed to publish review: ${error instanceof Error ? error.message : String(error)}`;
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

  if (publishError) {
    core.setFailed(publishError);
  } else if (!published) {
    core.setFailed("Failed to publish review. See warnings above for details.");
  } else if (
    missingIndices.length > 0 &&
    inputs.failOnMissingChunks
  ) {
    core.setFailed(
      `Published a partial review. Missing chunk(s): ${missingIndices.join(", ")}. ` +
      `Failing because fail-on-missing-chunks is enabled.`,
    );
  }
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
