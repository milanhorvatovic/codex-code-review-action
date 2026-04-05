#!/bin/bash
set -euo pipefail

# Resolve coverage summary path (artifact download location may vary).
if [ -f "coverage/coverage-summary.json" ]; then
  COVERAGE_FILE="coverage/coverage-summary.json"
elif [ -f "coverage-summary.json" ]; then
  COVERAGE_FILE="coverage-summary.json"
else
  echo "Coverage summary file not found. Checked 'coverage/coverage-summary.json' and 'coverage-summary.json'." >&2
  exit 1
fi

# Extract coverage total from vitest json-summary output.
TOTAL_RAW=$(node -e "const s = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log(s.total.lines.pct)" "$COVERAGE_FILE")
TOTAL=$(printf '%.0f' "$TOTAL_RAW")

# Map coverage percentage to badge color.
if [ "$TOTAL" -ge 90 ]; then
  COLOR="brightgreen"
elif [ "$TOTAL" -ge 80 ]; then
  COLOR="green"
elif [ "$TOTAL" -ge 70 ]; then
  COLOR="yellowgreen"
elif [ "$TOTAL" -ge 60 ]; then
  COLOR="yellow"
else
  COLOR="red"
fi

echo "Coverage: ${TOTAL}% (${COLOR})"

# Generate Shields.io endpoint JSON.
cat > coverage.json <<EOF
{
  "color": "${COLOR}",
  "label": "coverage",
  "message": "${TOTAL}%",
  "schemaVersion": 1
}
EOF

# Push to orphan badges branch.
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git checkout --orphan badges
git rm -rf .
mv coverage.json .
git add coverage.json
git commit -m "Update coverage badge to ${TOTAL}% [skip ci]"
git push origin badges --force
