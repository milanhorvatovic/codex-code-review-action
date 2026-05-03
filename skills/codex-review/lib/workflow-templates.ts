export type WorkflowTemplateOptions = {
  allowUsers: string;
  pinSha: string;
  pinTag: string;
};

export function renderHardenedWorkflow(opts: WorkflowTemplateOptions): string {
  const { allowUsers, pinSha, pinTag } = opts;
  if (!/^[0-9a-f]{40}$/.test(pinSha)) {
    throw new Error(`pinSha must be a 40-character lowercase hex SHA; got '${pinSha}'`);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(pinTag)) {
    throw new Error(`pinTag must look like vX.Y.Z; got '${pinTag}'`);
  }
  const allowUsersValue = allowUsers.trim().length === 0 ? "" : allowUsers.trim();
  const allowUsersLine = allowUsersValue.length === 0
    ? `          allow-users: "" # empty value allows all same-repo PR authors; tighten to a comma-separated allowlist`
    : `          allow-users: ${allowUsersValue} # bound the allowlist to known maintainers`;

  return `name: Codex code review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

concurrency:
  group: codex-review-\${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  prepare:
    if: \${{ !github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository }}
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    timeout-minutes: 10
    outputs:
      skipped: \${{ steps.prepare.outputs.skipped }}
      has-changes: \${{ steps.prepare.outputs.has-changes }}
      chunk-count: \${{ steps.prepare.outputs.chunk-count }}
      chunk-matrix: \${{ steps.prepare.outputs.chunk-matrix }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: \${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - id: prepare
        uses: milanhorvatovic/codex-ai-code-review-action/prepare@${pinSha} # ${pinTag}
        with:
${allowUsersLine}

      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        if: steps.prepare.outputs.skipped != 'true' && steps.prepare.outputs.has-changes == 'true'
        with:
          name: codex-prepare
          path: .codex/
          include-hidden-files: true
          retention-days: 1

  review:
    needs: prepare
    if: needs.prepare.outputs.skipped != 'true' && needs.prepare.outputs.has-changes == 'true' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    environment: codex-review
    permissions:
      contents: read
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix: \${{ fromJson(needs.prepare.outputs.chunk-matrix) }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: \${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - uses: milanhorvatovic/codex-ai-code-review-action/review@${pinSha} # ${pinTag}
        with:
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}
          chunk: \${{ matrix.chunk }}

  publish:
    needs: [prepare, review]
    if: always() && needs.prepare.outputs.skipped != 'true' && needs.prepare.outputs.has-changes == 'true' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: \${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          path: .codex/
          merge-multiple: true

      - uses: milanhorvatovic/codex-ai-code-review-action/publish@${pinSha} # ${pinTag}
        with:
          github-token: \${{ github.token }}
          expected-chunks: \${{ needs.prepare.outputs.chunk-count }}
          retain-findings: "false"
          fail-on-missing-chunks: "true"
`;
}
