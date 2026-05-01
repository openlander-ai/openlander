#!/usr/bin/env bash
# Echoes gzipped size of web/dist/assets/*.js, optionally compares against baseline.
# Per ralplan-monitoring-logs §Cross-cutting (Phase 1 step 0).
#
# Usage:
#   tools/qa/bundle-snapshot.sh             # measure + diff against baseline
#   tools/qa/bundle-snapshot.sh --baseline  # write baseline
#
# Exits non-zero when diff > +15 kB so it can gate PR merges.
set -euo pipefail
cd "$(dirname "$0")/../.."
total=0
for f in web/dist/assets/*.js; do
  size=$(gzip -c "$f" | wc -c)
  total=$((total + size))
  printf "%8d %s\n" "$size" "$f"
done
echo "TOTAL: $total bytes ($(echo "scale=1; $total/1024" | bc) kB) min+gz"
if [[ "${1:-}" == "--baseline" ]]; then
  echo "$total" > tools/qa/bundle-baseline.txt
  echo "Baseline written: $total bytes"
elif [[ -f tools/qa/bundle-baseline.txt ]]; then
  base=$(cat tools/qa/bundle-baseline.txt)
  diff=$((total - base))
  echo "Baseline: $base bytes; Diff: $diff bytes ($(echo "scale=1; $diff/1024" | bc) kB)"
  [[ $diff -gt 15360 ]] && { echo "FAIL: diff > +15 kB"; exit 1; }
fi
