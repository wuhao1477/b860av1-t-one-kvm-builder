import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('CNB pipeline declares the migrated event surfaces', () => {
  const config = read('.cnb.yml');
  for (const marker of [
    'main:',
    'push:',
    'pull_request:',
    'crontab: 23 3 * * 1',
    'web_trigger_weekly_raw:',
    'web_trigger_weekly_burn:',
    'web_trigger_verify_device:',
    'api_trigger_weekly_raw:',
    'api_trigger_weekly_burn:',
    'api_trigger_migrate_releases:',
    'scripts/cnb-weekly-raw-build.sh',
    'scripts/cnb-weekly-burn-build.sh',
    'scripts/cnb-heartbeat.sh',
  ]) assert.match(config, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('CNB CI runs on every branch except the heartbeat-only push', () => {
  const config = read('.cnb.yml');
  assert.match(config, /"\*\*":\s*\n\s+push:[\s\S]*ifModify:[\s\S]*"!\(\.github\/schedule-heartbeat\)"/);
});

test('CNB CI keeps the two independent GitHub jobs', () => {
  const config = read('.cnb.yml');
  assert.match(config, /\.ci-test:[\s\S]*script: bash scripts\/cnb-ci\.sh test/);
  assert.match(config, /\.ci-source-built-uboot:[\s\S]*script: bash scripts\/cnb-ci\.sh source-built-uboot/);
  assert.match(config, /name: ci-test[\s\S]*<<: \*ci-test/);
  assert.match(config, /name: ci-source-built-uboot[\s\S]*<<: \*ci-source-built-uboot/);
});

test('CNB pipeline does not depend on GitHub-only execution variables', () => {
  const config = read('.cnb.yml');
  assert.doesNotMatch(config, /github\.token|github\.repository|GITHUB_RUN_NUMBER|gh release/);
});

test('CNB scheduled heartbeat preserves the 42-day activity behavior', () => {
  const config = read('.cnb.yml');
  const heartbeat = read('scripts/cnb-heartbeat.sh');
  assert.match(config, /\.weekly-build:[\s\S]*endStages:[\s\S]*scripts\/cnb-heartbeat\.sh/);
  assert.match(config, /"crontab: 23 3 \* \* 1":[\s\S]*<<: \*weekly-build/);
  assert.doesNotMatch(config, /crontab: 22 3 \* \* 1/);
  assert.match(heartbeat, /42 \* 86400/);
  assert.match(heartbeat, /\.github\/schedule-heartbeat/);
  assert.match(heartbeat, /git push origin HEAD:main/);
});

test('CNB evidence PR trigger excludes the placeholder file', () => {
  const config = read('.cnb.yml');
  assert.match(config, /ifModify:[\s\S]*evidence\/\*\*[\s\S]*!\(evidence\/\.gitkeep\)/);
});

test('CNB device verification checks its evidence handoff before publishing', () => {
  const script = read('scripts/cnb-verify-device.sh');
  assert.match(script, /artifact-manifest\.sha256/);
  assert.match(script, /sha256sum --check[^\n]*artifact-manifest\.sha256/);
});

test('CNB raw release keeps the GitHub release asset set', () => {
  const script = read('scripts/cnb-weekly-raw-build.sh');
  const assets = script.match(/cnb-release\.mjs publish \\\n([\s\S]*?)\n  printf 'CNB raw release published/ )?.[1] ?? '';
  const assetTail = assets.slice(assets.indexOf('true false'));
  assert.match(assets, /out\/validation-report\.json/);
  assert.match(assets, /out\/release-tag\.txt/);
  assert.doesNotMatch(assetTail, /out\/RELEASE\.md/);
});

test('CNB raw pipeline preserves detect, build, validate, and publish stages', () => {
  const config = read('.cnb.yml');
  for (const phase of ['setup', 'detect', 'build', 'validate', 'publish']) {
    assert.match(config, new RegExp(`cnb-weekly-raw-build\\.sh ${phase}`));
  }
  assert.match(config, /exports:[\s\S]*changed: CNB_RAW_CHANGED/);
  assert.match(config, /if: '\[ "\$CNB_RAW_CHANGED" = "true" \]'/);
});

test('CNB burn pipeline preserves detect, build, and publish stages', () => {
  const config = read('.cnb.yml');
  const script = read('scripts/cnb-weekly-burn-build.sh');
  for (const phase of ['setup', 'detect', 'build', 'publish']) {
    assert.match(config, new RegExp(`cnb-weekly-burn-build\\.sh ${phase}`));
  }
  assert.match(config, /exports:[\s\S]*changed: CNB_BURN_CHANGED/);
  assert.match(config, /if: '\[ "\$CNB_BURN_CHANGED" = "true" \]'/);
  assert.match(script, /const \[, , , tag, assetName, expected\] = process\.argv;/);
  assert.match(script, /local source_assets=\"\$workspace\/source-assets\"/);
  assert.match(script, /for asset in SHA256SUMS resolved-sources\.json/);
  assert.match(script, /CNB_REPO_SLUG=\"\$source_repository\" node scripts\/cnb-release\.mjs download[\s\S]*\"\$source_assets\/\$asset\"/);
  assert.match(script, /rustup\.rs/);
  assert.match(script, /toolchain install stable/);
  assert.match(script, /ensure_stable_rust/);
});

test('CNB manual device verification has a validation gate before publication', () => {
  const config = read('.cnb.yml');
  const script = read('scripts/cnb-verify-device.sh');
  assert.match(config, /cnb-verify-device\.sh validate[\s\S]*cnb-verify-device\.sh publish/);
  assert.match(config, /if: '\[ "\$CNB_DEVICE_VALIDATED" = "true" \]'/);
  assert.match(script, /confirmation.*verify/);
});

test('CNB web triggers preserve the manual workflow inputs', () => {
  const trigger = read('.cnb/web_trigger.yml');
  for (const marker of ['force:', 'release_tag:', 'evidence_path:', 'confirmation:', 'web_trigger_weekly_raw', 'web_trigger_weekly_burn', 'web_trigger_verify_device']) {
    assert.match(trigger, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
