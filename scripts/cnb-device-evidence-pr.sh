#!/usr/bin/env bash
set -Eeuo pipefail

evidence_json=$(find evidence -type f -name device-validation.json -print -quit)
[[ -n "$evidence_json" ]] || { echo 'no device-validation.json found' >&2; exit 1; }
evidence_dir=$(dirname "$evidence_json")
release_tag=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).release.tag)" "$evidence_json")
release_dir=${RUNNER_TEMP:-${TMPDIR:-/tmp}/b860-cnb-runner}/release-assets
mkdir -p "$release_dir"

CNB_REPO_SLUG=${CNB_REPO_SLUG:?CNB_REPO_SLUG is required} \
  node scripts/cnb-release.mjs get "$release_tag" > "$release_dir/release.json"
for asset in SHA256SUMS build-input-heads.json release-tag.txt resolved-sources.json \
  validation-report.json filesystem-manifest.sha256 boot-components.json; do
  CNB_REPO_SLUG="$CNB_REPO_SLUG" node scripts/cnb-release.mjs download "$release_tag" "$asset" "$release_dir/$asset"
done

node scripts/validate-device-evidence.mjs \
  "$evidence_dir" "$release_dir" "$PWD" "$release_dir/device-validation-summary.json"
cat "$release_dir/device-validation-summary.json"
printf '%s\n' "device evidence validated: $evidence_dir" \
  "summary: $release_dir/device-validation-summary.json"
