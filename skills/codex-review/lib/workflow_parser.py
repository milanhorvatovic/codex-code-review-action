"""Workflow YAML parser tuned for the consumer-controls invariants.

The full GitHub Actions workflow grammar is large; we only parse what the CC-
predicates need: top-level on:, jobs:, per-job if/permissions/environment/env,
and per-step uses/with/env. Hand-rolled so the skill stays stdlib-only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Step:
    comments: tuple[str, ...]
    env: tuple[str, ...]
    uses: str | None
    with_: dict[str, str]


@dataclass(frozen=True)
class Job:
    comments: tuple[str, ...]
    env: tuple[str, ...]
    environment: str | None
    if_: str | None
    name: str
    permissions: dict[str, str]
    steps: tuple[Step, ...]


@dataclass(frozen=True)
class Workflow:
    comments: tuple[str, ...]
    jobs: tuple[Job, ...]
    on: tuple[str, ...]
    text: str


_SELF_USES = re.compile(
    r"milanhorvatovic/codex-ai-code-review-action(?:/(prepare|review|publish))?@([0-9a-f]{40}|v\d[^\s#]*|[\w./-]+)"
)


def _index_of_comment(line: str) -> int:
    in_single = False
    in_double = False
    for i, ch in enumerate(line):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            return i
    return -1


def _collect_all_comments(lines: list[str]) -> tuple[str, ...]:
    out: list[str] = []
    for line in lines:
        idx = _index_of_comment(line)
        if idx == -1:
            continue
        out.append(line[idx + 1 :].strip())
    return tuple(out)


def _parse_on(lines: list[str]) -> tuple[str, ...]:
    out: list[str] = []
    in_on = False
    base_indent: int | None = None
    for line in lines:
        if re.match(r"^on:\s*$", line):
            in_on = True
            continue
        m = re.match(r"^on:\s+\[(.+)\]", line)
        if m is not None:
            for event in m.group(1).split(","):
                out.append(event.strip())
            return tuple(sorted(out))
        if not in_on:
            continue
        if line == "":
            continue
        leading = len(line) - len(line.lstrip(" "))
        if leading == 0:
            in_on = False
            continue
        if base_indent is None:
            base_indent = leading
        if leading == base_indent:
            stripped = line[leading:]
            event_match = re.match(r"^([\w-]+):", stripped)
            if event_match is not None:
                out.append(event_match.group(1))
    return tuple(sorted(out))


@dataclass
class _PendingJob:
    name: str
    indent: int
    lines: list[str] = field(default_factory=list)


def _parse_jobs(lines: list[str]) -> tuple[Job, ...]:
    jobs: list[Job] = []
    in_jobs = False
    base_indent: int | None = None
    current: _PendingJob | None = None

    def commit() -> None:
        nonlocal current
        if current is None:
            return
        jobs.append(_parse_job(current.name, current.indent, current.lines))
        current = None

    for line in lines:
        if re.match(r"^jobs:\s*$", line):
            in_jobs = True
            continue
        if not in_jobs:
            continue
        trimmed = line.rstrip()
        if trimmed == "":
            if current is not None:
                current.lines.append(line)
            continue
        leading = len(line) - len(line.lstrip(" "))
        if leading == 0 and trimmed != "":
            commit()
            in_jobs = False
            continue
        if base_indent is None:
            base_indent = leading
        if leading == base_indent:
            stripped = line[leading:]
            job_match = re.match(r"^([\w-]+):\s*$", stripped)
            if job_match is not None:
                commit()
                current = _PendingJob(name=job_match.group(1), indent=leading)
                continue
        if current is not None:
            current.lines.append(line)
    commit()
    return tuple(jobs)


def _parse_job(name: str, job_indent: int, lines: list[str]) -> Job:
    field_indent = job_indent + 2
    if_expr: str | None = None
    environment: str | None = None
    permissions: dict[str, str] = {}
    env: list[str] = []
    steps: list[Step] = []
    comments: list[str] = []

    i = 0
    n = len(lines)
    while i < n:
        raw = lines[i]
        if raw == "":
            i += 1
            continue
        cmt_idx = _index_of_comment(raw)
        if cmt_idx != -1:
            comments.append(raw[cmt_idx + 1 :].strip())
        leading = len(raw) - len(raw.lstrip(" "))
        if leading != field_indent:
            i += 1
            continue
        stripped = re.sub(r"\s+#.*$", "", raw[field_indent:])
        if_match = re.match(r"^if:\s*(.*)$", stripped)
        if if_match is not None:
            if_expr = if_match.group(1).strip()
            i += 1
            continue
        env_match = re.match(r"^environment:\s*(.*)$", stripped)
        if env_match is not None and env_match.group(1).strip():
            environment = env_match.group(1).strip().strip("\"'")
            i += 1
            continue
        if re.match(r"^permissions:\s*$", stripped):
            i += 1
            while i < n:
                row = lines[i]
                row_indent = len(row) - len(row.lstrip(" "))
                if row.strip() == "":
                    i += 1
                    continue
                if row_indent <= field_indent:
                    break
                sub = re.sub(r"\s+#.*$", "", row[row_indent:]).strip()
                pm = re.match(r"^([\w-]+):\s*(\S+)\s*$", sub)
                if pm is not None:
                    permissions[pm.group(1)] = pm.group(2)
                i += 1
            continue
        if re.match(r"^env:\s*$", stripped):
            i += 1
            while i < n:
                row = lines[i]
                row_indent = len(row) - len(row.lstrip(" "))
                if row.strip() != "" and row_indent <= field_indent:
                    break
                if row.strip() != "":
                    env.append(row.strip())
                i += 1
            continue
        if re.match(r"^steps:\s*$", stripped):
            i += 1
            entries, i = _collect_step_entries(lines, i, field_indent)
            for entry in entries:
                steps.append(_parse_step(entry))
            continue
        i += 1
    return Job(
        comments=tuple(comments),
        env=tuple(env),
        environment=environment,
        if_=if_expr,
        name=name,
        permissions=permissions,
        steps=tuple(steps),
    )


def _collect_step_entries(lines: list[str], start: int, job_field_indent: int) -> tuple[list[list[str]], int]:
    entries: list[list[str]] = []
    current: list[str] | None = None
    i = start
    n = len(lines)
    while i < n:
        raw = lines[i]
        if raw == "":
            if current is not None:
                current.append(raw)
            i += 1
            continue
        leading = len(raw) - len(raw.lstrip(" "))
        if leading <= job_field_indent and raw.strip() != "":
            break
        stripped = raw[leading:]
        if stripped.startswith("- "):
            if current is not None:
                entries.append(current)
            current = [stripped[2:]]
        elif current is not None:
            current.append(stripped)
        i += 1
    if current is not None:
        entries.append(current)
    return entries, i


def _strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        return value[1:-1]
    return value


def _parse_step(step_lines: list[str]) -> Step:
    comments: list[str] = []
    env_lines: list[str] = []
    uses: str | None = None
    with_map: dict[str, str] = {}
    in_with = False

    for raw in step_lines:
        cmt_idx = _index_of_comment(raw)
        if cmt_idx != -1:
            comments.append(raw[cmt_idx + 1 :].strip())
        stripped = re.sub(r"\s+#.*$", "", raw).lstrip()
        if stripped == "":
            continue
        uses_match = re.match(r"^uses:\s*(\S+)", stripped)
        if uses_match is not None:
            uses = uses_match.group(1)
            in_with = False
            continue
        if re.match(r"^with:\s*$", stripped):
            in_with = True
            continue
        if re.match(r"^env:\s*$", stripped):
            in_with = False
            continue
        if in_with:
            kv = re.match(r"^([\w-]+):\s*(.*)$", stripped)
            if kv is not None:
                with_map[kv.group(1)] = _strip_quotes(kv.group(2).strip())
        if "${{" in raw and "secrets." in raw:
            env_lines.append(raw.strip())
        elif "OPENAI_API_KEY" in raw:
            env_lines.append(raw.strip())
    return Step(comments=tuple(comments), env=tuple(env_lines), uses=uses, with_=with_map)


def parse_workflow(text: str) -> Workflow:
    lines = text.splitlines()
    return Workflow(
        comments=_collect_all_comments(lines),
        jobs=_parse_jobs(lines),
        on=_parse_on(lines),
        text=text,
    )


@dataclass(frozen=True)
class SelfPin:
    sub: str | None
    ref: str


def self_pin(line: str) -> SelfPin | None:
    match = _SELF_USES.search(line)
    if match is None:
        return None
    return SelfPin(sub=match.group(1), ref=match.group(2) or "")


@dataclass(frozen=True)
class StepUsingSelf:
    job: str
    sub: str | None
    ref: str


def find_steps_using_self(workflow: Workflow) -> tuple[StepUsingSelf, ...]:
    out: list[StepUsingSelf] = []
    for job in workflow.jobs:
        for step in job.steps:
            if step.uses is None:
                continue
            pin = self_pin(step.uses)
            if pin is None:
                continue
            out.append(StepUsingSelf(job=job.name, sub=pin.sub, ref=pin.ref))
    return tuple(out)
