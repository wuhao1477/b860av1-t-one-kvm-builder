#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/.." && pwd)
cd -- "$repo_root"

workspace=${CNB_BUILD_WORKSPACE:-$repo_root}
run_dir="$workspace/.cnb/raw"
runner_temp=${RUNNER_TEMP:-$run_dir/runner}
mkdir -p "$run_dir" "$runner_temp"
export RUNNER_TEMP="$runner_temp"

force=${force:-${FORCE:-false}}
run_identity=$(node scripts/cnb-run-identity.mjs)
run_number=${run_identity%.*}
run_attempt=${run_identity##*.}
manifest="$run_dir/resolved-sources.json"
previous_dir="$run_dir/previous-release"

setup() {
  apt-get update
  apt-get install --yes \
    bc bison build-essential curl debian-archive-keyring device-tree-compiler \
    dosfstools e2fsprogs expect file flex gcc-aarch64-linux-gnu git gzip \
    initramfs-tools-core kmod kpartx libssl-dev make mtools parted proot \
    python3 qemu-system-arm qemu-user-static sudo swig tar u-boot-tools \
    util-linux xz-utils
  corepack enable
}

detect() {
  local decision changed fingerprint latest_tag
  mkdir -p "$previous_dir"
  scripts/verify-debian-stable.sh "$run_dir/debian-stable.json" "$run_dir/debian-stable"
  node scripts/resolve-sources.mjs --output "$manifest" --debian-stable "$run_dir/debian-stable.json"
  CNB_REPO_SLUG=${CNB_REPO_SLUG:?CNB_REPO_SLUG is required} node scripts/cnb-release-audit.mjs

  latest_tag=$(CNB_REPO_SLUG="$CNB_REPO_SLUG" node --input-type=module - <<'NODE'
import { createCnbReleaseClient } from './src/cnb-release.mjs';
const releases = await createCnbReleaseClient().listReleases();
const candidates = releases.filter((release) => !release.isDraft
  && release.isPrerelease && release.tagName.startsWith('armbian-'));
process.stdout.write(candidates[0]?.tagName ?? '');
NODE
  )
  if [[ -n "$latest_tag" ]]; then
    CNB_REPO_SLUG="$CNB_REPO_SLUG" node scripts/cnb-release.mjs get "$latest_tag" > "$previous_dir/release.json"
    CNB_REPO_SLUG="$CNB_REPO_SLUG" node scripts/cnb-release.mjs download \
      "$latest_tag" resolved-sources.json "$previous_dir/resolved-sources.json"
    CNB_REPO_SLUG="$CNB_REPO_SLUG" node scripts/cnb-release.mjs download \
      "$latest_tag" validation-report.json "$previous_dir/validation-report.json"
  fi

  decision=$(CURRENT_MANIFEST="$manifest" \
    PREVIOUS_MANIFEST="$previous_dir/resolved-sources.json" \
    PREVIOUS_REPORT="$previous_dir/validation-report.json" \
    PREVIOUS_RELEASE_STATE="$previous_dir/release.json" FORCE="$force" \
    node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { compareFingerprints, validatePublishedState, validateReleaseAssets } from './src/change-detection.mjs';
import { validateManifest } from './src/upstream.mjs';

const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const current = validateManifest(read(process.env.CURRENT_MANIFEST));
const paths = [process.env.PREVIOUS_MANIFEST, process.env.PREVIOUS_REPORT, process.env.PREVIOUS_RELEASE_STATE];
const present = paths.map((path) => fs.existsSync(path));
if (new Set(present).size !== 1) throw new Error('previous CNB release state is incomplete');
let previous = null;
if (present[0]) {
  const report = read(process.env.PREVIOUS_REPORT);
  previous = validatePublishedState(read(process.env.PREVIOUS_MANIFEST), report);
  validateReleaseAssets(report, read(process.env.PREVIOUS_RELEASE_STATE));
}
process.stdout.write(JSON.stringify({
  ...compareFingerprints(current, previous, process.env.FORCE === 'true'),
  fingerprint: current.fingerprint,
}));
NODE
  )
  printf '%s\n' "$decision" > "$run_dir/cnb-detect.json"
  changed=$(node -e "console.log(JSON.parse(process.argv[1]).changed)" "$decision")
  fingerprint=$(node -e "console.log(JSON.parse(process.argv[1]).fingerprint)" "$decision")
  printf '##[set-output changed=%s]\n' "$changed"
  printf '##[set-output fingerprint=%s]\n' "$fingerprint"
  printf 'CNB raw detect: changed=%s fingerprint=%s\n' "$changed" "$fingerprint"
}

build() {
  pnpm install --frozen-lockfile
  scripts/build-raw-image.sh "$manifest" "$workspace/out"
}

validate() {
  local image image_name release_tag fingerprint
  image=$(find "$workspace/out" -maxdepth 1 -type f -name '*.img.gz' -print -quit)
  [[ -n "$image" ]] || { echo 'raw image is missing' >&2; exit 1; }
  scripts/build-uboot-overload.sh "$workspace/out/resolved-sources.json" "$runner_temp/uboot-validation"
  cp "$runner_temp/uboot-validation/uboot-build.json" "$workspace/out/uboot-build.json"
  cp "$runner_temp/uboot-validation/u-boot-source.tar.gz" "$workspace/out/u-boot-source.tar.gz"
  node scripts/write-build-input-heads.mjs "$workspace/out/resolved-sources.json" "$workspace/out/build-input-heads.json"
  scripts/validate-raw-image.sh "$image" "$workspace/out/validation-report.json" \
    "$workspace/out/resolved-sources.json" "$workspace/out/uboot-build.json"
  image_name=$(basename "$image")
  (cd "$workspace/out" && sha256sum -- "$image_name" > SHA256SUMS)
  release_tag=$(node --input-type=module - "$run_number" "$run_attempt" "$workspace/out/resolved-sources.json" <<'NODE'
import fs from 'node:fs';
import { releaseTagForManifest } from './src/release.mjs';
const manifest = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
process.stdout.write(releaseTagForManifest(manifest, process.argv[2], process.argv[3]));
NODE
  )
  printf '%s\n' "$release_tag" > "$workspace/out/release-tag.txt"
  node scripts/render-release-notes.mjs "$workspace/out/resolved-sources.json" \
    "$workspace/out/validation-report.json" "$workspace/out/RELEASE.md" "$release_tag"
  fingerprint=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).fingerprint)" \
    "$workspace/out/resolved-sources.json")
  node scripts/validate-candidate-artifacts.mjs "$workspace/out" "$fingerprint"
}

publish() {
  local image armbian_version debian_codename debian_version kernel_version release_tag title fingerprint
  image=$(find "$workspace/out" -maxdepth 1 -type f -name '*.img.gz' -print -quit)
  release_tag=$(<"$workspace/out/release-tag.txt")
  fingerprint=${CNB_RAW_FINGERPRINT:-$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).fingerprint)" "$workspace/out/resolved-sources.json")}
  armbian_version=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).sources.base.armbianVersion)" "$workspace/out/resolved-sources.json")
  debian_codename=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).board.distribution)" "$workspace/out/resolved-sources.json")
  debian_version=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).sources.debian.version)" "$workspace/out/resolved-sources.json")
  kernel_version=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).sources.kernel.version)" "$workspace/out/resolved-sources.json")
  title="Armbian ${armbian_version} / Debian ${debian_version} (${debian_codename^}) / kernel ${kernel_version} / build ${run_number}.${run_attempt}"
  CNB_REPO_SLUG="$CNB_REPO_SLUG" node scripts/cnb-release.mjs publish \
    "$release_tag" "${CNB_COMMIT:?CNB_COMMIT is required}" "$title" "$workspace/out/RELEASE.md" \
    true false \
    "$workspace/out/SHA256SUMS" "$workspace/out/resolved-sources.json" \
    "$workspace/out/build-input-heads.json" "$workspace/out/boot-components.json" \
    "$workspace/out/uboot-build.json" "$workspace/out/u-boot-source.tar.gz" \
    "$workspace/out/source-built-dtb.json" "$workspace/out/device-tree-source.dts" \
    "$workspace/out/qemu-system-smoke.json" "$workspace/out/qemu-system-smoke.log" \
    "$workspace/out/rtl8189fs-driver.json" "$workspace/out/hardware-capabilities.json" \
    "$workspace/out/THIRD_PARTY_SOURCES.md" "$workspace/out/filesystem-manifest.sha256" \
    "$workspace/out/validation-report.json" "$workspace/out/release-tag.txt" "$image"
  printf 'CNB raw release published: %s fingerprint=%s\n' "$release_tag" "$fingerprint"
}

run_all() {
  setup
  detect
  if [[ "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).changed)" "$run_dir/cnb-detect.json")" == true ]]; then
    build
    validate
    publish
  else
    echo 'CNB raw build skipped: resolved fingerprint is unchanged'
  fi
}

case "${1:-all}" in
  setup) setup ;;
  detect) detect ;;
  build) build ;;
  validate) validate ;;
  publish) publish ;;
  all) run_all ;;
  *) echo "usage: $0 [setup|detect|build|validate|publish|all]" >&2; exit 2 ;;
esac
