import { readFileSync } from "node:fs";

import { runAllDiagnoses, type Diagnosis } from "../../lib/diagnoses/index.js";
import { parseFindings, type Findings } from "../../lib/findings-loader.js";

export type TuneInputs = {
  findingsPath?: string;
  findingsText?: string;
  referencePath?: string;
  workflowPath?: string;
};

export type TuneOutputs = {
  diagnoses: ReadonlyArray<Diagnosis>;
  findings: Findings;
  report: string;
};

export class TuneError extends Error {
  override name = "TuneError";
}

function loadFindings(inputs: TuneInputs): Findings {
  if (inputs.findingsText !== undefined) return parseFindings(inputs.findingsText);
  if (inputs.findingsPath !== undefined) return parseFindings(readFileSync(inputs.findingsPath, "utf-8"));
  throw new TuneError("supply either findings-path or findings-text");
}

function renderReport(findings: Findings, diagnoses: ReadonlyArray<Diagnosis>): string {
  const triggered = diagnoses.filter((d) => d.triggered);
  const skipped = diagnoses.filter((d) => !d.triggered);

  const lines: string[] = [];
  lines.push("# Tune report");
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`- Overall correctness: \`${findings.overall_correctness}\``);
  lines.push(`- Overall confidence: \`${findings.overall_confidence_score.toFixed(2)}\``);
  lines.push(`- Total findings: \`${findings.findings.length}\``);
  lines.push("");

  if (triggered.length === 0) {
    lines.push("## Recommendations");
    lines.push("");
    lines.push("No diagnoses fired. The verdict is well-calibrated, the P3 surface is below the noise threshold, and the summary contains no truncation banner. No changes recommended.");
    lines.push("");
  } else {
    for (const diagnosis of triggered) {
      for (const rec of diagnosis.recommendations) {
        lines.push(`## Recommendation: ${rec.kind}`);
        lines.push("");
        lines.push(`Target: \`${rec.target}\`.`);
        lines.push("");
        lines.push("```diff");
        lines.push(rec.diff);
        lines.push("```");
        lines.push("");
        lines.push("### Rationale");
        lines.push("");
        lines.push(rec.rationale);
        if (rec.contributingFindings.length > 0) {
          lines.push("");
          lines.push("### Contributing findings");
          lines.push("");
          for (const title of rec.contributingFindings) lines.push(`- ${title}`);
        }
        lines.push("");
      }
    }
  }

  lines.push("## Diagnoses summary");
  lines.push("");
  for (const diagnosis of diagnoses) {
    const mark = diagnosis.triggered ? "fired" : "skipped";
    lines.push(`- \`${diagnosis.kind}\`: ${mark}`);
  }
  lines.push("");
  if (skipped.length === diagnoses.length && triggered.length === 0) {
    lines.push("All diagnoses skipped — no tuning required.");
  }

  return lines.join("\n");
}

export function runTune(inputs: TuneInputs): TuneOutputs {
  const findings = loadFindings(inputs);
  const diagnoses = runAllDiagnoses(findings);
  const report = renderReport(findings, diagnoses);
  return { diagnoses, findings, report };
}
