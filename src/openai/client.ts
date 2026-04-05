import * as core from "@actions/core";
import OpenAI from "openai";

import { isReviewOutput } from "../config/types.js";
import type { ReviewOutput } from "../config/types.js";

const REQUEST_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 3;

export async function reviewChunk(
  prompt: string,
  schema: Record<string, unknown>,
  model: string,
  apiKey: string,
): Promise<ReviewOutput> {
  const resolvedModel = model.trim() || undefined;
  const client = new OpenAI({
    apiKey,
    maxRetries: MAX_RETRIES,
    timeout: REQUEST_TIMEOUT_MS,
  });

  core.info(`Model: ${resolvedModel ?? "(API default)"}`);
  core.info(`Prompt: ${prompt.length} chars`);

  const response = await client.responses.create({
    input: [{ content: prompt, role: "user" }],
    ...(resolvedModel ? { model: resolvedModel } : {}),
    text: {
      format: {
        name: "code_review",
        schema,
        strict: true,
        type: "json_schema",
      },
    },
  });

  const text = extractResponseText(response);
  const parsed: unknown = JSON.parse(text);

  if (!isReviewOutput(parsed)) {
    throw new Error("API response does not match ReviewOutput shape");
  }

  core.info(`Review output: ${text.length} chars`);
  return parsed;
}

function extractResponseText(response: OpenAI.Responses.Response): string {
  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (content.type === "output_text" && typeof content.text === "string") {
            return content.text;
          }
        }
      }
    }
  }

  throw new Error(
    `Unexpected API response structure: ${JSON.stringify(response).slice(0, 500)}`,
  );
}

