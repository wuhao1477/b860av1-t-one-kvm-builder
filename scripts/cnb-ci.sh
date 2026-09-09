#!/usr/bin/env bash
set -Eeuo pipefail

runner_temp=${RUNNER_TEMP:-${TMPDIR:-/tmp}/b860-cnb-runner}
mkdir -p "$runner_temp"
export RUNNER_TEMP="$runner_temp"

run_tests() {
  apt-get update
  apt-get install --yes expect device-tree-compiler mtools
  corepack enable
  pnpm install --frozen-lockfile
  pnpm test
  bash -n scripts/*.sh tools/hcenc/*.sh
  node --input-type=module -e "import { inspectTrackedFiles } from './src/repository-policy.mjs'; const violations = inspectTrackedFiles(new URL('.', import.meta.url)); if (violations.length) { console.error(violations.join('\\n')); process.exit(1); }"
}

run_source_built_checks() {
  apt-get update
  apt-get install --yes \
    bc bison build-essential curl device-tree-compiler flex \
    gcc-aarch64-linux-gnu git libssl-dev make python3 swig

  commit=$(git ls-remote https://github.com/u-boot/u-boot.git 'refs/tags/v2020.07^{}' | awk '{print $1}')
  [[ "$commit" == 2f5fbb5b39f7b67044dda5c35e4a4b31685a3109 ]]
  node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { buildManifest } from './src/upstream.mjs';

const board = JSON.parse(fs.readFileSync('config/board.json', 'utf8'));
fs.writeFileSync('uboot-ci-manifest.json', `${JSON.stringify(buildManifest({
  schemaVersion: 4,
  board: { ...board, distribution: 'trixie', distributionVersion: '13' },
  recipe: { schemaVersion: 1, files: { fixture: '0'.repeat(64) } },
  sources: {
    base: { name: 'Armbian_test.img.gz', url: 'https://example.invalid/base', digest: '1'.repeat(64), size: 1, armbianVersion: '1.0.0' },
    kernel: { name: '5.10.1.tar.gz', url: 'https://example.invalid/kernel', digest: '2'.repeat(64), size: 1, version: '5.10.1' },
    builder: { repository: 'ophub/amlogic-s9xxx-armbian', commit: '3'.repeat(40) },
    ubootSource: { repository: 'u-boot/u-boot', ref: 'v2020.07', commit: '2f5fbb5b39f7b67044dda5c35e4a4b31685a3109' },
    debian: { codename: 'trixie', date: '2025-08-09T12:00:00.000Z', digest: '6'.repeat(64), majorVersion: '13', sourceUrl: 'https://deb.debian.org/debian/dists/stable/InRelease', suite: 'stable', version: '13.0' },
  },
}), null, 2)}\n`);
NODE
  scripts/build-uboot-overload.sh uboot-ci-manifest.json "$runner_temp/uboot-first"
  scripts/build-uboot-overload.sh uboot-ci-manifest.json "$runner_temp/uboot-second"
  cmp "$runner_temp/uboot-first/u-boot-s905x-s912.bin" "$runner_temp/uboot-second/u-boot-s905x-s912.bin"
  cmp "$runner_temp/uboot-first/uboot-build.json" "$runner_temp/uboot-second/uboot-build.json"
  cmp "$runner_temp/uboot-first/u-boot-source.tar.gz" "$runner_temp/uboot-second/u-boot-source.tar.gz"

  node --input-type=module - <<'NODE'
import fs from 'node:fs';
const board = JSON.parse(fs.readFileSync('config/board.json', 'utf8'));
fs.writeFileSync('dtb-ci-manifest.json', `${JSON.stringify({ schemaVersion: 5, board }, null, 2)}\n`);
NODE
  scripts/build-board-dtb.sh dtb-ci-manifest.json "$runner_temp/dtb-first"
  scripts/build-board-dtb.sh dtb-ci-manifest.json "$runner_temp/dtb-second"
  cmp "$runner_temp/dtb-first/meson-gxl-s905x-p212-b860av11t.dtb" "$runner_temp/dtb-second/meson-gxl-s905x-p212-b860av11t.dtb"
  cmp "$runner_temp/dtb-first/source-built-dtb.json" "$runner_temp/dtb-second/source-built-dtb.json"
  cmp "$runner_temp/dtb-first/device-tree-source.dts" "$runner_temp/dtb-second/device-tree-source.dts"
}

case "${1:-all}" in
  test) run_tests ;;
  source-built-uboot) run_source_built_checks ;;
  all) run_tests; run_source_built_checks ;;
  *) echo "usage: $0 [test|source-built-uboot|all]" >&2; exit 2 ;;
esac
