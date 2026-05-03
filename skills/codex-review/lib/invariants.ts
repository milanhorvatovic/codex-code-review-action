import { PREDICATES, type InvariantId, type InvariantOutcome } from "./invariants/predicates.js";
import { parseWorkflow } from "./workflow-parser.js";

export type AssertOptions = {
  actionVersion?: string | null;
  ids?: ReadonlyArray<InvariantId>;
};

export type AssertReport = {
  failures: ReadonlyArray<InvariantOutcome>;
  ok: boolean;
  outcomes: ReadonlyArray<InvariantOutcome>;
};

export const ALL_INVARIANTS: ReadonlyArray<InvariantId> = [
  "CC-01",
  "CC-02",
  "CC-03",
  "CC-04",
  "CC-05",
  "CC-06",
  "CC-07",
  "CC-08",
  "CC-09",
  "CC-EXTRA-01-bare-action",
];

export function assertWorkflow(yamlText: string, opts: AssertOptions = {}): AssertReport {
  const workflow = parseWorkflow(yamlText);
  const ids = opts.ids ?? ALL_INVARIANTS;
  const outcomes = ids.map((id) => PREDICATES[id]({ actionVersion: opts.actionVersion ?? null, workflow }));
  const failures = outcomes.filter((o) => !o.ok);
  return { failures, ok: failures.length === 0, outcomes };
}

export function formatReport(report: AssertReport): string {
  const lines: string[] = [];
  for (const outcome of report.outcomes) {
    const mark = outcome.ok ? "✓" : "✗";
    lines.push(`${mark} ${outcome.id}: ${outcome.detail}`);
  }
  return lines.join("\n");
}
