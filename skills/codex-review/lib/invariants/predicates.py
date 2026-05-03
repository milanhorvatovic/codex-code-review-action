"""Per-invariant predicate functions.

Each predicate consumes an InvariantContext (parsed workflow + action
version) and returns an InvariantOutcome (id, ok, detail). The engine in
``__init__.py`` composes the full report from these.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Literal

from ..workflow_parser import Job, Workflow, find_steps_using_self

type InvariantId = Literal[
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
]


@dataclass(frozen=True)
class InvariantContext:
    action_version: str | None
    workflow: Workflow


@dataclass(frozen=True)
class InvariantOutcome:
    detail: str
    id: InvariantId
    ok: bool


_SAME_REPO_GATE = "github.event.pull_request.head.repo.full_name == github.repository"
_RETENTION_CONSENT_PHRASE = "retention approved"
_WORKSPACE_MODE_CONSENT_PHRASE = "workspace-mode accepted"


def _find_job(workflow: Workflow, name: str) -> Job | None:
    for job in workflow.jobs:
        if job.name == name:
            return job
    return None


def _is_v21_or_later(version: str | None) -> bool:
    if version is None:
        return False
    match = re.match(r"^v(\d+)\.(\d+)", version)
    if match is None:
        return False
    major = int(match.group(1))
    minor = int(match.group(2))
    if major > 2:
        return True
    return major == 2 and minor >= 1


def _workflow_mentions_base_source(workflow: Workflow) -> bool:
    return bool(re.search(r"review-reference-source:\s*[\"']?base[\"']?", workflow.text))


def _workflow_has_consent_phrase(workflow: Workflow, phrase: str) -> bool:
    return any(phrase.lower() in comment.lower() for comment in workflow.comments)


def _render_job_text(workflow_text: str, job_name: str) -> str:
    out: list[str] = []
    in_job = False
    base_indent: int | None = None
    pattern = re.compile(rf"^( +){re.escape(job_name)}:\s*$")
    for line in workflow_text.splitlines():
        leading = len(line) - len(line.lstrip(" "))
        if not in_job:
            match = pattern.match(line)
            if match is not None:
                in_job = True
                base_indent = len(match.group(1))
            continue
        if line.strip() == "":
            out.append(line)
            continue
        if base_indent is not None and leading <= base_indent:
            break
        out.append(line)
    return "\n".join(out)


def check_cc01(ctx: InvariantContext) -> InvariantOutcome:
    refs = find_steps_using_self(ctx.workflow)
    sub_refs = [ref for ref in refs if ref.sub is not None]
    if not sub_refs:
        return InvariantOutcome(id="CC-01", ok=False, detail="no prepare/review/publish references found")
    sha_refs = [ref for ref in sub_refs if re.match(r"^[0-9a-f]{40}$", ref.ref)]
    if len(sha_refs) != len(sub_refs):
        return InvariantOutcome(
            id="CC-01", ok=False, detail="one or more sub-action uses: lines are not pinned to a 40-char SHA"
        )
    unique = {ref.ref for ref in sha_refs}
    if len(unique) != 1:
        return InvariantOutcome(
            id="CC-01",
            ok=False,
            detail=f"prepare/review/publish pinned to {len(unique)} distinct SHAs; expected 1",
        )
    return InvariantOutcome(
        id="CC-01", ok=True, detail=f"all sub-actions pinned to the same SHA ({next(iter(unique))})"
    )


def check_cc02(ctx: InvariantContext) -> InvariantOutcome:
    events = ctx.workflow.on
    if "pull_request_target" in events:
        return InvariantOutcome(id="CC-02", ok=False, detail="workflow triggers on pull_request_target")
    if "pull_request" not in events:
        return InvariantOutcome(id="CC-02", ok=False, detail="workflow does not trigger on pull_request")
    return InvariantOutcome(id="CC-02", ok=True, detail="triggers on pull_request only")


def check_cc03(ctx: InvariantContext) -> InvariantOutcome:
    for name in ("prepare", "review", "publish"):
        job = _find_job(ctx.workflow, name)
        if job is None:
            return InvariantOutcome(id="CC-03", ok=False, detail=f"job {name} missing")
        if job.if_ is None or _SAME_REPO_GATE not in job.if_:
            return InvariantOutcome(
                id="CC-03", ok=False, detail=f"job {name} does not carry the same-repo gate in its if: expression"
            )
    return InvariantOutcome(id="CC-03", ok=True, detail="every job carries the same-repo gate")


def check_cc04(ctx: InvariantContext) -> InvariantOutcome:
    for name in ("prepare", "publish"):
        job = _find_job(ctx.workflow, name)
        if job is None:
            continue
        if job.environment is not None and len(job.environment) > 0:
            return InvariantOutcome(
                id="CC-04", ok=False, detail=f"job {name} declares environment: {job.environment}"
            )
        text = _render_job_text(ctx.workflow.text, job.name)
        if "secrets.OPENAI_API_KEY" in text:
            return InvariantOutcome(id="CC-04", ok=False, detail=f"job {name} references secrets.OPENAI_API_KEY")
    review = _find_job(ctx.workflow, "review")
    if review is not None:
        text = _render_job_text(ctx.workflow.text, review.name)
        if "secrets.OPENAI_API_KEY" not in text:
            return InvariantOutcome(id="CC-04", ok=False, detail="review job does not reference secrets.OPENAI_API_KEY")
    return InvariantOutcome(id="CC-04", ok=True, detail="OPENAI_API_KEY confined to the review job")


def check_cc05(ctx: InvariantContext) -> InvariantOutcome:
    for name in ("prepare", "review"):
        job = _find_job(ctx.workflow, name)
        if job is None:
            continue
        for key, value in job.permissions.items():
            if value == "write":
                return InvariantOutcome(id="CC-05", ok=False, detail=f"job {name} has {key}: write")
        if job.permissions.get("contents") != "read":
            return InvariantOutcome(id="CC-05", ok=False, detail=f"job {name} does not declare contents: read")
    return InvariantOutcome(id="CC-05", ok=True, detail="prepare and review are read-only")


def check_cc06(ctx: InvariantContext) -> InvariantOutcome:
    publish = _find_job(ctx.workflow, "publish")
    if publish is None:
        return InvariantOutcome(id="CC-06", ok=False, detail="publish job missing")
    if publish.permissions.get("pull-requests") != "write":
        return InvariantOutcome(id="CC-06", ok=False, detail="publish does not declare pull-requests: write")
    for key, value in publish.permissions.items():
        if key not in ("contents", "pull-requests") and value == "write":
            return InvariantOutcome(id="CC-06", ok=False, detail=f"publish has extra write scope {key}: write")
    for name in ("prepare", "review"):
        job = _find_job(ctx.workflow, name)
        if job is None:
            continue
        if job.permissions.get("pull-requests") == "write":
            return InvariantOutcome(id="CC-06", ok=False, detail=f"job {name} also has pull-requests: write")
    return InvariantOutcome(id="CC-06", ok=True, detail="publish exclusively holds pull-requests: write")


def check_cc07(ctx: InvariantContext) -> InvariantOutcome:
    publish = _find_job(ctx.workflow, "publish")
    if publish is None:
        return InvariantOutcome(id="CC-07", ok=False, detail="publish job missing")
    for step in publish.steps:
        value = step.with_.get("retain-findings")
        if value is None:
            continue
        if value == "false":
            return InvariantOutcome(id="CC-07", ok=True, detail="retain-findings is explicitly false")
        if value == "true":
            if _workflow_has_consent_phrase(ctx.workflow, _RETENTION_CONSENT_PHRASE):
                return InvariantOutcome(
                    id="CC-07", ok=True, detail="retain-findings is true with a 'retention approved' consent comment"
                )
            return InvariantOutcome(
                id="CC-07",
                ok=False,
                detail="retain-findings is true without a 'retention approved' consent comment",
            )
    return InvariantOutcome(id="CC-07", ok=True, detail="retain-findings is unset (upstream default false)")


def check_cc08(ctx: InvariantContext) -> InvariantOutcome:
    if not _is_v21_or_later(ctx.action_version):
        return InvariantOutcome(id="CC-08", ok=True, detail="skipped: action version is pre-v2.1.0 or unknown")
    publish = _find_job(ctx.workflow, "publish")
    if publish is None:
        return InvariantOutcome(id="CC-08", ok=False, detail="publish job missing")
    for step in publish.steps:
        if step.with_.get("fail-on-missing-chunks") == "true":
            return InvariantOutcome(id="CC-08", ok=True, detail="fail-on-missing-chunks is true")
    return InvariantOutcome(
        id="CC-08", ok=False, detail="fail-on-missing-chunks is not set to true on a v2.1.0+ workflow"
    )


def check_cc09(ctx: InvariantContext) -> InvariantOutcome:
    prepare = _find_job(ctx.workflow, "prepare")
    if prepare is None:
        return InvariantOutcome(id="CC-09", ok=True, detail="skipped: prepare job missing")
    declares = any("review-reference-file" in step.with_ for step in prepare.steps)
    if not declares:
        return InvariantOutcome(id="CC-09", ok=True, detail="review-reference-file is not passed")
    if _workflow_mentions_base_source(ctx.workflow):
        return InvariantOutcome(
            id="CC-09", ok=True, detail="review-reference-file is wired with review-reference-source: base"
        )
    if _workflow_has_consent_phrase(ctx.workflow, _WORKSPACE_MODE_CONSENT_PHRASE):
        return InvariantOutcome(
            id="CC-09",
            ok=True,
            detail="review-reference-file is wired with a 'workspace-mode accepted' consent comment",
        )
    return InvariantOutcome(
        id="CC-09",
        ok=False,
        detail="review-reference-file is wired without consent or base-mode (issue #97)",
    )


def check_bare_action(ctx: InvariantContext) -> InvariantOutcome:
    for job in ctx.workflow.jobs:
        for step in job.steps:
            if step.uses is None:
                continue
            match = re.search(
                r"milanhorvatovic/codex-ai-code-review-action(?:/(prepare|review|publish))?@", step.uses
            )
            if match is not None and match.group(1) is None:
                return InvariantOutcome(
                    id="CC-EXTRA-01-bare-action",
                    ok=False,
                    detail=f"job {job.name} pins the bare action; rewrite to /prepare, /review, /publish",
                )
    return InvariantOutcome(id="CC-EXTRA-01-bare-action", ok=True, detail="no bare-action references")


PREDICATES: dict[InvariantId, Callable[[InvariantContext], InvariantOutcome]] = {
    "CC-01": check_cc01,
    "CC-02": check_cc02,
    "CC-03": check_cc03,
    "CC-04": check_cc04,
    "CC-05": check_cc05,
    "CC-06": check_cc06,
    "CC-07": check_cc07,
    "CC-08": check_cc08,
    "CC-09": check_cc09,
    "CC-EXTRA-01-bare-action": check_bare_action,
}
