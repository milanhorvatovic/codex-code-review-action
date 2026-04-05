import * as fs from "node:fs";

import * as artifact from "@actions/artifact";
import * as core from "@actions/core";

import { defaultPrompt, defaultReference, defaultSchema } from "../config/defaults.js";
import { getReviewInputs } from "../config/inputs.js";
import { isAuthorAllowed } from "../core/allowlist.js";
import { buildChunkMatrix, buildDiff, fetchBaseSha, splitDiff } from "../core/diff.js";
import { mergeChunkReviews } from "../core/merge.js";
import { assemblePrompt } from "../core/prompt.js";
import { getPullRequestContext } from "../github/context.js";
import { reviewChunk } from "../openai/client.js";

const CODEX_DIR = ".codex";
const REVIEW_OUTPUT_FILE = `${CODEX_DIR}/review-output.json`;
const DIFF_FILE = `${CODEX_DIR}/pr.diff`;
const ARTIFACT_NAME = "codex-review-findings";
const ARTIFACT_RETENTION_DAYS = 90;

async function run(): Promise<void> {
  const inputs = getReviewInputs();
  const prContext = getPullRequestContext();

  if (!inputs.apiKey) {
    core.setOutput("skipped", "true");
    core.warning("openai-api-key is required but was empty.");
    return;
  }

  if (!isAuthorAllowed(inputs.allowedUsers, prContext.author)) {
    core.setOutput("skipped", "true");
    core.info(`PR author '${prContext.author}' is not in the allowed users list. Skipping review.`);
    return;
  }

  core.setOutput("skipped", "false");

  core.startGroup("Building PR diff");
  await fetchBaseSha(prContext.baseSha, inputs.githubToken);
  const diff = await buildDiff(prContext.baseSha, prContext.headSha);
  fs.mkdirSync(CODEX_DIR, { recursive: true });
  fs.writeFileSync(DIFF_FILE, diff);
  core.endGroup();

  if (diff.trim().length === 0) {
    core.setOutput("has-changes", "false");
    core.info("Diff is empty — nothing to review.");
    return;
  }
  core.setOutput("has-changes", "true");

  core.startGroup("Splitting diff into chunks");
  const chunks = splitDiff(diff, inputs.maxChunkBytes);
  core.info(`Created ${chunks.length} chunk(s)`);
  core.setOutput("chunk-count", String(chunks.length));
  core.setOutput("chunk-matrix", buildChunkMatrix(chunks.length));
  core.endGroup();

  const referenceContent = inputs.reviewReferenceFile
    ? fs.readFileSync(inputs.reviewReferenceFile, "utf8")
    : defaultReference;

  const schema = defaultSchema as Record<string, unknown>;
  const chunkResults = [];

  for (let i = 0; i < chunks.length; i++) {
    core.startGroup(`Reviewing chunk ${i}...`);
    const prompt = assemblePrompt({
      diff: chunks[i],
      headSha: prContext.headSha,
      prBody: prContext.body,
      prNumber: prContext.number,
      prTitle: prContext.title,
      promptTemplate: defaultPrompt,
      reference: referenceContent,
      reviewRunId: `${Date.now()}-${i}`,
    });

    const result = await reviewChunk(prompt, schema, inputs.model, inputs.apiKey);
    chunkResults.push(result);
    core.endGroup();
  }

  core.startGroup("Merging chunk reviews");
  const merged = mergeChunkReviews(chunkResults, chunks.length);
  fs.writeFileSync(REVIEW_OUTPUT_FILE, JSON.stringify(merged, null, 2));
  core.info(`Merged review: ${merged.findings.length} finding(s) -> ${REVIEW_OUTPUT_FILE}`);
  core.endGroup();

  core.setOutput("findings-count", String(merged.findings.length));
  core.setOutput("verdict", merged.overall_correctness);

  if (inputs.retainFindings) {
    core.startGroup("Uploading review findings artifact");
    const client = new artifact.DefaultArtifactClient();
    await client.uploadArtifact(
      ARTIFACT_NAME,
      [REVIEW_OUTPUT_FILE, DIFF_FILE],
      CODEX_DIR,
      { retentionDays: ARTIFACT_RETENTION_DAYS },
    );
    core.info(`Uploaded findings artifact: ${ARTIFACT_NAME}`);
    core.endGroup();
  }
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
