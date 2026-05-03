import type { Job, Workflow } from "../workflow-parser.js";
import { findStepsUsingSelf } from "../workflow-parser.js";

export type InvariantId =
  | "CC-01"
  | "CC-02"
  | "CC-03"
  | "CC-04"
  | "CC-05"
  | "CC-06"
  | "CC-07"
  | "CC-08"
  | "CC-09"
  | "CC-EXTRA-01-bare-action";

export type InvariantContext = {
  actionVersion?: string | null;
  workflow: Workflow;
};

export type InvariantOutcome = {
  detail: string;
  id: InvariantId;
  ok: boolean;
};

const SAME_REPO_GATE = "github.event.pull_request.head.repo.full_name == github.repository";
const RETENTION_CONSENT_PHRASE = "retention approved";
const WORKSPACE_MODE_CONSENT_PHRASE = "workspace-mode accepted";

function findJob(workflow: Workflow, name: string): Job | null {
  return workflow.jobs.find((job) => job.name === name) ?? null;
}

function isV21OrLater(version: string | null | undefined): boolean {
  if (typeof version !== "string") return false;
  const m = /^v(\d+)\.(\d+)/.exec(version);
  if (m === null) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > 2) return true;
  return major === 2 && minor >= 1;
}

function workflowMentionsBaseSource(workflow: Workflow): boolean {
  return /review-reference-source:\s*["']?base["']?/.test(workflow.text);
}

function workflowHasConsentPhrase(workflow: Workflow, phrase: string): boolean {
  return workflow.comments.some((comment) => comment.toLowerCase().includes(phrase));
}

export function checkCC01(ctx: InvariantContext): InvariantOutcome {
  const refs = findStepsUsingSelf(ctx.workflow);
  const subRefs = refs.filter((r) => r.sub !== null);
  if (subRefs.length === 0) {
    return { detail: "no prepare/review/publish references found", id: "CC-01", ok: false };
  }
  const shaRefs = subRefs.filter((r) => /^[0-9a-f]{40}$/.test(r.ref));
  if (shaRefs.length !== subRefs.length) {
    return { detail: "one or more sub-action uses: lines are not pinned to a 40-char SHA", id: "CC-01", ok: false };
  }
  const unique = new Set(shaRefs.map((r) => r.ref));
  if (unique.size !== 1) {
    return { detail: `prepare/review/publish pinned to ${unique.size} distinct SHAs; expected 1`, id: "CC-01", ok: false };
  }
  return { detail: `all sub-actions pinned to the same SHA (${[...unique][0] ?? ""})`, id: "CC-01", ok: true };
}

export function checkCC02(ctx: InvariantContext): InvariantOutcome {
  const events = ctx.workflow.on;
  if (events.includes("pull_request_target")) {
    return { detail: "workflow triggers on pull_request_target", id: "CC-02", ok: false };
  }
  if (!events.includes("pull_request")) {
    return { detail: "workflow does not trigger on pull_request", id: "CC-02", ok: false };
  }
  return { detail: "triggers on pull_request only", id: "CC-02", ok: true };
}

export function checkCC03(ctx: InvariantContext): InvariantOutcome {
  for (const name of ["prepare", "review", "publish"] as const) {
    const job = findJob(ctx.workflow, name);
    if (job === null) {
      return { detail: `job ${name} missing`, id: "CC-03", ok: false };
    }
    if (job.if === null || !job.if.includes(SAME_REPO_GATE)) {
      return { detail: `job ${name} does not carry the same-repo gate in its if: expression`, id: "CC-03", ok: false };
    }
  }
  return { detail: "every job carries the same-repo gate", id: "CC-03", ok: true };
}

export function checkCC04(ctx: InvariantContext): InvariantOutcome {
  for (const name of ["prepare", "publish"] as const) {
    const job = findJob(ctx.workflow, name);
    if (job === null) continue;
    if (job.environment !== null && job.environment.length > 0) {
      return { detail: `job ${name} declares environment: ${job.environment}`, id: "CC-04", ok: false };
    }
    const text = renderJobText(ctx.workflow.text, job.name);
    if (/secrets\.OPENAI_API_KEY/.test(text)) {
      return { detail: `job ${name} references secrets.OPENAI_API_KEY`, id: "CC-04", ok: false };
    }
  }
  const review = findJob(ctx.workflow, "review");
  if (review !== null) {
    const text = renderJobText(ctx.workflow.text, review.name);
    if (!/secrets\.OPENAI_API_KEY/.test(text)) {
      return { detail: "review job does not reference secrets.OPENAI_API_KEY", id: "CC-04", ok: false };
    }
  }
  return { detail: "OPENAI_API_KEY confined to the review job", id: "CC-04", ok: true };
}

function renderJobText(workflowText: string, jobName: string): string {
  const lines = workflowText.split(/\r?\n/);
  const out: string[] = [];
  let inJob = false;
  let baseIndent: number | null = null;
  for (const line of lines) {
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (!inJob) {
      const m = new RegExp(`^( +)${jobName}:\\s*$`).exec(line);
      if (m !== null && m[1] !== undefined) {
        inJob = true;
        baseIndent = m[1].length;
        continue;
      }
      continue;
    }
    if (line.trim() === "") {
      out.push(line);
      continue;
    }
    if (baseIndent !== null && indent <= baseIndent) break;
    out.push(line);
  }
  return out.join("\n");
}

export function checkCC05(ctx: InvariantContext): InvariantOutcome {
  for (const name of ["prepare", "review"] as const) {
    const job = findJob(ctx.workflow, name);
    if (job === null) continue;
    for (const [key, value] of job.permissions) {
      if (value === "write") {
        return { detail: `job ${name} has ${key}: write`, id: "CC-05", ok: false };
      }
    }
    if ((job.permissions.get("contents") ?? "") !== "read") {
      return { detail: `job ${name} does not declare contents: read`, id: "CC-05", ok: false };
    }
  }
  return { detail: "prepare and review are read-only", id: "CC-05", ok: true };
}

export function checkCC06(ctx: InvariantContext): InvariantOutcome {
  const publish = findJob(ctx.workflow, "publish");
  if (publish === null) {
    return { detail: "publish job missing", id: "CC-06", ok: false };
  }
  if ((publish.permissions.get("pull-requests") ?? "") !== "write") {
    return { detail: "publish does not declare pull-requests: write", id: "CC-06", ok: false };
  }
  for (const [key, value] of publish.permissions) {
    if (key !== "contents" && key !== "pull-requests" && value === "write") {
      return { detail: `publish has extra write scope ${key}: write`, id: "CC-06", ok: false };
    }
  }
  for (const name of ["prepare", "review"] as const) {
    const job = findJob(ctx.workflow, name);
    if (job === null) continue;
    if ((job.permissions.get("pull-requests") ?? "") === "write") {
      return { detail: `job ${name} also has pull-requests: write`, id: "CC-06", ok: false };
    }
  }
  return { detail: "publish exclusively holds pull-requests: write", id: "CC-06", ok: true };
}

export function checkCC07(ctx: InvariantContext): InvariantOutcome {
  const publish = findJob(ctx.workflow, "publish");
  if (publish === null) {
    return { detail: "publish job missing", id: "CC-07", ok: false };
  }
  for (const step of publish.steps) {
    const value = step.with.get("retain-findings");
    if (value === undefined) continue;
    if (value === "false") return { detail: "retain-findings is explicitly false", id: "CC-07", ok: true };
    if (value === "true") {
      if (workflowHasConsentPhrase(ctx.workflow, RETENTION_CONSENT_PHRASE)) {
        return { detail: "retain-findings is true with a 'retention approved' consent comment", id: "CC-07", ok: true };
      }
      return { detail: "retain-findings is true without a 'retention approved' consent comment", id: "CC-07", ok: false };
    }
  }
  return { detail: "retain-findings is unset (upstream default false)", id: "CC-07", ok: true };
}

export function checkCC08(ctx: InvariantContext): InvariantOutcome {
  if (!isV21OrLater(ctx.actionVersion ?? null)) {
    return { detail: "skipped: action version is pre-v2.1.0 or unknown", id: "CC-08", ok: true };
  }
  const publish = findJob(ctx.workflow, "publish");
  if (publish === null) {
    return { detail: "publish job missing", id: "CC-08", ok: false };
  }
  for (const step of publish.steps) {
    const value = step.with.get("fail-on-missing-chunks");
    if (value === "true") return { detail: "fail-on-missing-chunks is true", id: "CC-08", ok: true };
  }
  return { detail: "fail-on-missing-chunks is not set to true on a v2.1.0+ workflow", id: "CC-08", ok: false };
}

export function checkCC09(ctx: InvariantContext): InvariantOutcome {
  const prepare = findJob(ctx.workflow, "prepare");
  if (prepare === null) {
    return { detail: "skipped: prepare job missing", id: "CC-09", ok: true };
  }
  const declares = prepare.steps.some((step) => step.with.has("review-reference-file"));
  if (!declares) return { detail: "review-reference-file is not passed", id: "CC-09", ok: true };

  const baseModeOn = workflowMentionsBaseSource(ctx.workflow);
  const consented = workflowHasConsentPhrase(ctx.workflow, WORKSPACE_MODE_CONSENT_PHRASE);
  if (baseModeOn) {
    return { detail: "review-reference-file is wired with review-reference-source: base", id: "CC-09", ok: true };
  }
  if (consented) {
    return { detail: "review-reference-file is wired with a 'workspace-mode accepted' consent comment", id: "CC-09", ok: true };
  }
  return {
    detail: "review-reference-file is wired without consent or base-mode (issue #97)",
    id: "CC-09",
    ok: false,
  };
}

export function checkBareAction(ctx: InvariantContext): InvariantOutcome {
  for (const job of ctx.workflow.jobs) {
    for (const step of job.steps) {
      if (step.uses === null) continue;
      const m = /milanhorvatovic\/codex-ai-code-review-action(?:\/(prepare|review|publish))?@/.exec(step.uses);
      if (m !== null && m[1] === undefined) {
        return {
          detail: `job ${job.name} pins the bare action; rewrite to /prepare, /review, /publish`,
          id: "CC-EXTRA-01-bare-action",
          ok: false,
        };
      }
    }
  }
  return { detail: "no bare-action references", id: "CC-EXTRA-01-bare-action", ok: true };
}

export const PREDICATES: Record<InvariantId, (ctx: InvariantContext) => InvariantOutcome> = {
  "CC-01": checkCC01,
  "CC-02": checkCC02,
  "CC-03": checkCC03,
  "CC-04": checkCC04,
  "CC-05": checkCC05,
  "CC-06": checkCC06,
  "CC-07": checkCC07,
  "CC-08": checkCC08,
  "CC-09": checkCC09,
  "CC-EXTRA-01-bare-action": checkBareAction,
};
