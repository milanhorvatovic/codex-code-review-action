import * as fs from "node:fs";

import * as core from "@actions/core";

import { defaultPrompt, defaultReference, defaultSchema } from "../config/defaults.js";
import { getPrepareInputs } from "../config/inputs.js";
import { isAuthorAllowed } from "../core/allowlist.js";
import { buildChunkMatrix, splitDiff } from "../core/diff.js";
import { assemblePrompt } from "../core/prompt.js";
import {
  ReviewReferenceFileError,
  resolveReviewReferenceFromBase,
  resolveReviewReferenceFromWorkspace,
} from "./referenceFile.js";
import { getPullRequestContext } from "../github/context.js";
import { buildDiff, fetchBaseSha } from "../github/git.js";

const CODEX_DIR = ".codex";
const DIFF_FILE = `${CODEX_DIR}/pr.diff`;
const SCHEMA_FILE = `${CODEX_DIR}/review-output-schema.json`;


async function run(): Promise<void> {
  const inputs = getPrepareInputs();
  const prContext = getPullRequestContext();

  if (!isAuthorAllowed(inputs.allowedUsers, prContext.author)) {
    core.setOutput("skipped", "true");
    core.setOutput("has-changes", "false");
    core.setOutput("chunk-count", "0");
    core.setOutput("chunk-matrix", buildChunkMatrix(0));
    core.info(`PR author '${prContext.author}' is not in the allowed users list. Skipping review.`);
    return;
  }

  core.setOutput("skipped", "false");

  let diff: string;
  core.startGroup("Building PR diff");
  try {
    await fetchBaseSha(prContext.baseSha, inputs.githubToken);
    diff = await buildDiff(prContext.baseSha, prContext.headSha);
    fs.mkdirSync(CODEX_DIR, { recursive: true });
    fs.writeFileSync(DIFF_FILE, diff);
  } catch (error) {
    core.setFailed(
      `Failed to build PR diff: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  } finally {
    core.endGroup();
  }

  if (diff.trim().length === 0) {
    core.setOutput("has-changes", "false");
    core.setOutput("chunk-count", "0");
    core.setOutput("chunk-matrix", buildChunkMatrix(0));
    core.info("Diff is empty — nothing to review.");
    return;
  }
  core.setOutput("has-changes", "true");

  core.startGroup("Splitting diff into chunks");
  let chunks: string[];
  try {
    chunks = splitDiff(diff, inputs.maxChunkBytes);
    core.info(`Created ${chunks.length} chunk(s)`);
    core.setOutput("chunk-count", String(chunks.length));
    core.setOutput("chunk-matrix", buildChunkMatrix(chunks.length));
  } catch (error) {
    core.setFailed(
      `Failed to split diff: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  } finally {
    core.endGroup();
  }

  const referenceFilePath = inputs.reviewReferenceFile.trim();
  let referenceContent = defaultReference;
  if (referenceFilePath) {
    try {
      if (inputs.reviewReferenceSource === "base") {
        referenceContent = await resolveReviewReferenceFromBase(
          referenceFilePath,
          prContext.baseSha,
        );
      } else {
        referenceContent = resolveReviewReferenceFromWorkspace(
          referenceFilePath,
          process.env.GITHUB_WORKSPACE ?? process.cwd(),
        );
      }
    } catch (error) {
      if (error instanceof ReviewReferenceFileError) {
        core.setFailed(`Invalid review-reference-file: ${error.message}`);
        return;
      }
      if (inputs.reviewReferenceSource === "base") {
        core.setFailed(
          `Failed to read review-reference-file at base SHA: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
      throw error;
    }
  }

  core.startGroup("Writing prompt and schema files");
  try {
    for (let i = 0; i < chunks.length; i++) {
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

      const promptFile = `${CODEX_DIR}/chunk-${i}-prompt.md`;
      fs.writeFileSync(promptFile, prompt);
      core.info(`Wrote ${promptFile} (${prompt.length} chars)`);
    }

    fs.writeFileSync(SCHEMA_FILE, JSON.stringify(defaultSchema, null, 2));
    core.info(`Wrote ${SCHEMA_FILE}`);
  } catch (error) {
    core.setFailed(
      `Failed to write prompt/schema files: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  } finally {
    core.endGroup();
  }
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
