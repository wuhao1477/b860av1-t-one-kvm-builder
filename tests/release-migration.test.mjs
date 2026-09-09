import assert from 'node:assert/strict';
import test from 'node:test';

import {
  githubReleaseToCnbInput,
  githubAssetDigest,
  migrationAssetName,
  releaseMetadataMatches,
} from '../src/release-migration.mjs';

const githubRelease = {
  tag_name: 'v1.0.0',
  target_commitish: 'main',
  name: 'B860 release',
  body: 'notes',
  draft: false,
  prerelease: true,
  assets: [{ name: 'file.bin', size: 3, digest: `sha256:${'a'.repeat(64)}` }],
};

test('maps GitHub release metadata to CNB release input', () => {
  assert.deepEqual(githubReleaseToCnbInput(githubRelease), {
    tagName: 'v1.0.0',
    targetCommitish: 'main',
    name: 'B860 release',
    body: 'notes',
    draft: false,
    isPrerelease: true,
    makeLatest: 'false',
  });
});

test('normalizes GitHub asset digests and detects exact release metadata matches', () => {
  assert.equal(githubAssetDigest(githubRelease.assets[0]), 'a'.repeat(64));
  assert.equal(releaseMetadataMatches(githubRelease, {
    tagName: 'v1.0.0',
    name: 'B860 release',
    body: 'notes',
    isDraft: false,
    isPrerelease: true,
  }), true);
  assert.equal(releaseMetadataMatches(githubRelease, {
    tagName: 'v1.0.0',
    name: 'changed',
    body: 'notes',
    isDraft: false,
    isPrerelease: true,
  }), false);
});

test('uses the original GitHub basename for migrated CNB asset names', () => {
  assert.equal(migrationAssetName('v1.2.0', 'SHA256SUMS'), 'SHA256SUMS');
  assert.equal(migrationAssetName('v1.2.0', 'nested/image.img.gz'), 'image.img.gz');
});
