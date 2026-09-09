#!/usr/bin/env bash
set -Eeuo pipefail

release_tag=${release_tag:-${RELEASE_TAG:-}}
evidence_path=${evidence_path:-${EVIDENCE_PATH:-}}
confirmation=${confirmation:-${CONFIRMATION:-}}
workspace=${CNB_BUILD_WORKSPACE:-$PWD}
device_dir="$workspace/.cnb/device"
release_dir="$device_dir/release-assets"
validated_dir="$device_dir/validated-evidence"

require_inputs() {
  [[ "$confirmation" == verify ]] || { echo 'confirmation must equal verify' >&2; exit 1; }
  [[ -n "$release_tag" && -n "$evidence_path" ]] || {
    echo 'release_tag and evidence_path are required' >&2
    exit 1
  }
  test -f "$evidence_path/device-validation.json"
  test -f "$evidence_path/device-serial.log"
}

setup() {
  apt-get update
  apt-get install --yes jq
  mkdir -p "$release_dir" "$validated_dir"
}

validate() {
  require_inputs
  CNB_REPO_SLUG=${CNB_REPO_SLUG:?CNB_REPO_SLUG is required} \
    node scripts/cnb-release.mjs get "$release_tag" > "$release_dir/release.json"
  for asset in SHA256SUMS build-input-heads.json release-tag.txt resolved-sources.json \
    validation-report.json filesystem-manifest.sha256 boot-components.json; do
    CNB_REPO_SLUG="$CNB_REPO_SLUG" node scripts/cnb-release.mjs download \
      "$release_tag" "$asset" "$release_dir/$asset"
  done

  node scripts/validate-device-evidence.mjs \
    "$evidence_path" "$release_dir" "$workspace" "$release_dir/device-validation-summary.json"
  node scripts/render-device-validation-summary.mjs \
    "$release_dir/device-validation-summary.json" "$release_dir/device-validation.md"

  local evidence_id json serial markdown
  evidence_id=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).evidenceId)" \
    "$evidence_path/device-validation.json")
  json="device-validation-$evidence_id.json"
  serial="device-serial-$evidence_id.log"
  markdown="device-validation-$evidence_id.md"
  cp "$evidence_path/device-validation.json" "$validated_dir/$json"
  cp "$evidence_path/device-serial.log" "$validated_dir/$serial"
  cp "$release_dir/device-validation.md" "$validated_dir/$markdown"
  (cd "$validated_dir" && sha256sum -- * > artifact-manifest.sha256)
  (cd "$validated_dir" && sha256sum --check artifact-manifest.sha256)
  printf '##[set-output validated=true]\n'
  cat "$release_dir/device-validation-summary.json"
}

publish() {
  require_inputs
  (cd "$validated_dir" && sha256sum --check artifact-manifest.sha256)
  CNB_REPO_SLUG=${CNB_REPO_SLUG:?CNB_REPO_SLUG is required} \
    node scripts/cnb-release.mjs get "$release_tag" > "$release_dir/release.json"
  local release_id evidence_id json serial markdown remote_assets asset
  release_id=$(jq -r '.id' "$release_dir/release.json")
  evidence_id=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).evidenceId)" \
    "$evidence_path/device-validation.json")
  json="device-validation-$evidence_id.json"
  serial="device-serial-$evidence_id.log"
  markdown="device-validation-$evidence_id.md"
  remote_assets=$(jq -r '.assets[].name' "$release_dir/release.json")
  for asset in "$json" "$serial" "$markdown"; do
    if printf '%s\n' "$remote_assets" | grep -Fxq "$asset"; then
      echo "Release asset already exists: $asset" >&2
      exit 1
    fi
    CNB_REPO_SLUG="$CNB_REPO_SLUG" node scripts/cnb-release.mjs upload \
      "$release_id" "$validated_dir/$asset" false
  done
  CNB_REPO_SLUG="$CNB_REPO_SLUG" node scripts/cnb-release.mjs verify "$release_tag" \
    "$validated_dir/$json" "$validated_dir/$serial" "$validated_dir/$markdown"
}

run_all() {
  [[ "$confirmation" == verify ]] || { echo 'confirmation must equal verify' >&2; exit 1; }
  setup
  validate
  publish
}

case "${1:-all}" in
  setup) setup ;;
  validate) validate ;;
  publish) publish ;;
  all) run_all ;;
  *) echo "usage: $0 [setup|validate|publish|all]" >&2; exit 2 ;;
esac
