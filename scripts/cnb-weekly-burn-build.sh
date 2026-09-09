#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/.." && pwd)
cd -- "$repo_root"

workspace=${CNB_BUILD_WORKSPACE:-$repo_root}
run_dir="$workspace/.cnb/burn"
runner_temp=${RUNNER_TEMP:-$run_dir/runner}
mkdir -p "$run_dir" "$runner_temp"
export RUNNER_TEMP="$runner_temp"

force=${force:-${FORCE:-false}}
run_identity=$(node scripts/cnb-run-identity.mjs)
run_number=${run_identity%.*}
run_attempt=${run_identity##*.}
repo=${CNB_REPO_SLUG:?CNB_REPO_SLUG is required}
source_repository=${SOURCE_REPOSITORY:-$repo}
source_release=${SOURCE_RELEASE:-input-armbian-26.11.0-debian-13.6-trixie-k5.10.268-build-46.1}
source_asset=${SOURCE_ASSET:-Armbian_26.11.0_amlogic_b860av1-t_trixie_5.10.268_server_2026.08.31.img.gz}
source_digest=${SOURCE_DIGEST:-32f5b8079e6c5ff8642e0703cfc0a8ae4402b1057b46bb3b8ce7181283da6ace}
detect_file="$run_dir/cnb-detect.json"
rustup_home="$run_dir/rustup"
cargo_home="$run_dir/cargo"

ensure_stable_rust() {
  if [[ ! -x "$cargo_home/bin/cargo" ]]; then
    curl --fail --location --retry 3 https://sh.rustup.rs \
      | RUSTUP_HOME="$rustup_home" CARGO_HOME="$cargo_home" sh -s -- \
        -y --profile minimal --default-toolchain stable
  else
    RUSTUP_HOME="$rustup_home" CARGO_HOME="$cargo_home" \
      "$cargo_home/bin/rustup" toolchain install stable --profile minimal
  fi
  export RUSTUP_HOME="$rustup_home"
  export CARGO_HOME="$cargo_home"
  export PATH="$cargo_home/bin:$PATH"
  rustc --version
  cargo --version
}

setup() {
  apt-get update
  apt-get install --yes \
    build-essential cargo curl device-tree-compiler dosfstools e2fsprogs file \
    gcc-aarch64-linux-gnu git gzip kmod kpartx libgnutls28-dev make mtools \
    parted python3 rustc sudo tar u-boot-tools util-linux xz-utils
  ensure_stable_rust
  corepack enable
}

detect() {
  local current asset recipe_digest fingerprint previous changed
  mkdir -p "$run_dir/source-assets"
  CNB_REPO_SLUG="$source_repository" node scripts/cnb-release.mjs get "$source_release" > "$run_dir/source-release.json"
  node --input-type=module - "$run_dir/source-release.json" "$source_release" "$source_asset" "$source_digest" <<'NODE'
import fs from 'node:fs';
const release = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const [, , , tag, assetName, expected] = process.argv;
const asset = release.assets.find((entry) => entry.name === assetName);
if (!asset || release.isDraft || asset.digest !== `sha256:${expected}` || asset.state !== 'uploaded') {
  throw new Error(`frozen CNB source release is invalid: ${tag}/${assetName}`);
}
NODE
  recipe_digest=$(sha256sum \
    .cnb.yml .cnb/web_trigger.yml scripts/cnb-weekly-burn-build.sh \
    board-inputs/DDR.USB board-inputs/UBOOT.USB board-inputs/aml_sdc_burn.UBOOT \
    board-inputs/aml_sdc_burn.ini board-inputs/platform.conf board-inputs/bootloader.PARTITION \
    board-inputs/logo.PARTITION board-inputs/meson1.dtb config/board.json \
    config/burn-inputs.json config/burn-tooling.json config/mainline-boot.json \
    board-overlays/burn-partitions.dtso scripts/build-burn-payloads.sh \
    scripts/build-vendor-boot-burn.sh scripts/validate-vendor-boot-burn.sh \
    scripts/setup-image-tools.sh scripts/apply-rootfs-defaults.sh \
    scripts/sync-rootfs-tree.mjs \
    scripts/fetch-vdec-firmware.sh scripts/build-hcodec-module.sh config/sources.json \
    tools/hcenc/fetch-vendor.sh tools/hcodec-mod/meson_hcodec.c tools/hcodec-mod/kmshim.h \
    tools/hcodec-mod/Makefile scripts/burn-image.mjs scripts/mainline-boot.mjs \
    src/android-sparse.mjs src/burn-dtb-roles.mjs src/emmc-boot-chain.mjs \
    | sha256sum | awk '{print $1}')
  fingerprint=$(printf '%s\n%s\n%s\n%s\n' "$source_release" "$source_asset" "$source_digest" "$recipe_digest" | sha256sum | awk '{print $1}')
  previous=$(CNB_REPO_SLUG="$repo" node --input-type=module - <<'NODE'
import { createCnbReleaseClient } from './src/cnb-release.mjs';
const releases = await createCnbReleaseClient().listReleases();
const release = releases.find((entry) => !entry.isDraft && entry.isPrerelease
  && entry.tagName.startsWith('b860-burn-'));
const match = release?.body.match(/^Input fingerprint: ([0-9a-f]{64})$/m);
process.stdout.write(match?.[1] ?? '');
NODE
  )
  changed=true
  if [[ "$force" != true && "$fingerprint" == "$previous" ]]; then changed=false; fi
  printf '%s\n' "{\"changed\":$changed,\"fingerprint\":\"$fingerprint\"}" > "$detect_file"
  printf '##[set-output changed=%s]\n' "$changed"
  printf '##[set-output fingerprint=%s]\n' "$fingerprint"
  printf 'CNB burn detect: changed=%s fingerprint=%s\n' "$changed" "$fingerprint"
}

build() {
  local source_dir="$run_dir/source-assets"
  local source_assets="$workspace/source-assets"
  mkdir -p "$source_dir" "$source_assets"
  CNB_REPO_SLUG="$source_repository" node scripts/cnb-release.mjs download \
    "$source_release" "$source_asset" "$source_dir/$source_asset"
  cp -- "$source_dir/$source_asset" "$source_assets/$source_asset"
  for asset in SHA256SUMS resolved-sources.json validation-report.json build-input-heads.json boot-components.json \
    uboot-build.json u-boot-source.tar.gz source-built-dtb.json device-tree-source.dts \
    qemu-system-smoke.json qemu-system-smoke.log rtl8189fs-driver.json hardware-capabilities.json \
    THIRD_PARTY_SOURCES.md filesystem-manifest.sha256; do
    CNB_REPO_SLUG="$source_repository" node scripts/cnb-release.mjs download \
      "$source_release" "$asset" "$source_assets/$asset"
  done
  find "$source_assets" -maxdepth 1 -type f -print | sort
  manifest_fingerprint=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).fingerprint)" "$source_assets/resolved-sources.json")
  node scripts/validate-candidate-artifacts.mjs "$source_assets" "$manifest_fingerprint"
  ensure_stable_rust
  scripts/setup-image-tools.sh "$repo_root/.tools" >/dev/null
  export PATH="$repo_root/.tools/bin:$PATH"
  scripts/build-burn-payloads.sh "$source_assets/$source_asset" "$workspace/payloads"
  scripts/build-vendor-boot-burn.sh "$workspace/payloads" "$workspace/out"
  scripts/validate-vendor-boot-burn.sh "$workspace/out/burn.img" "$workspace/out/vendor-boot-contract.json"
  xz -T0 -6e --check=sha256 --stdout "$workspace/out/burn.img" > "$workspace/out/burn.img.xz"
  xz -t "$workspace/out/burn.img.xz"
  original=$(sha256sum "$workspace/out/burn.img" | awk '{print $1}')
  expanded=$(xz --decompress --stdout "$workspace/out/burn.img.xz" | sha256sum | awk '{print $1}')
  [[ "$expanded" == "$original" ]] || { echo 'xz expansion digest differs from burn.img' >&2; exit 1; }
  local fingerprint=${CNB_BURN_FINGERPRINT:-$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).fingerprint)" "$detect_file")}
  cnb_url=${CNB_REPO_URL_HTTPS:-https://cnb.cool/$repo}
  printf 'Input fingerprint: %s\nPublic release: %s\nStrategy: vendor-fip-vendor-bl33-android-boot\nStatus: format-valid / strategy hardware-verified 2026-09-03\n\n这是每周自动构建的 prerelease —— 构建策略与实机验证过的那份一致，但这一份字节流本身没有上机测试过。\n想要逐字节验证过的包，请查看 CNB Release：%s/-/releases/latest\n\n上游输入已冻结在 `%s`，解冻步骤见 [docs/frozen-inputs.md](%s/-/blob/main/docs/frozen-inputs.md)。\nBurning Tool 里必须勾「擦除 flash」和「擦除 bootloader」；刷机步骤与设计说明见 [docs/burn-image.md](%s/-/blob/main/docs/burn-image.md)。\n' \
    "$fingerprint" "$source_release" "$cnb_url" "$source_release" "$cnb_url" "$cnb_url" > "$workspace/out/RELEASE.md"
  (cd "$workspace/out" && sha256sum burn.img burn.img.xz vendor-boot-contract.json burn-dtb-contract.json RELEASE.md > SHA256SUMS && sha256sum --check SHA256SUMS)
}

publish() {
  local tag="b860-burn-${source_release#Armbian_}-build-${run_number}.${run_attempt}"
  CNB_REPO_SLUG="$repo" node scripts/cnb-release.mjs publish \
    "$tag" "${CNB_COMMIT:?CNB_COMMIT is required}" "$tag" "$workspace/out/RELEASE.md" \
    true false "$workspace/out/burn.img" "$workspace/out/burn.img.xz" \
    "$workspace/out/SHA256SUMS" "$workspace/out/vendor-boot-contract.json" \
    "$workspace/out/burn-dtb-contract.json" "$workspace/out/RELEASE.md"
  printf 'CNB burn release published: %s\n' "$tag"
}

run_all() {
  setup
  detect
  if [[ "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).changed)" "$detect_file")" == true ]]; then
    build
    publish
  else
    echo 'CNB burn build skipped: frozen input fingerprint is unchanged'
  fi
}

case "${1:-all}" in
  setup) setup ;;
  detect) detect ;;
  build) build ;;
  publish) publish ;;
  all) run_all ;;
  *) echo "usage: $0 [setup|detect|build|publish|all]" >&2; exit 2 ;;
esac
