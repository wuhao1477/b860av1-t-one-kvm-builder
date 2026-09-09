#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { createCnbReleaseClient, releaseAssetMap } from '../src/cnb-release.mjs';
import { githubAssetDigest, githubReleaseToCnbInput, migrationAssetName, releaseMetadataMatches } from '../src/release-migration.mjs';

const sourceRepo = process.env.GITHUB_SOURCE_REPOSITORY || 'wuhao1477/b860av1-t-armbian-burn-builder';
const cnbRepo = process.env.CNB_REPO_SLUG || 'wuhao1477/b860av1-t-armbian-burn-builder';

async function githubJson(path) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const paginated = path.includes('/releases?');
      const output = execFileSync('curl', [
        '--noproxy', '*', '--fail', '--silent', '--show-error', '--location', '--max-time', '30',
        '-H', 'Accept: application/vnd.github+json', `https://api.github.com${path}`,
      ], {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 50 * 1024 * 1024,
        env: process.env,
      });
      return JSON.parse(output.trim());
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

async function downloadGithubAsset(asset, destination, token) {
  let response;
  const timeoutMs = Math.max(120_000, Math.min(2 * 60 * 60 * 1000, Number(asset.size || 0) * 2));
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(asset.browser_download_url, {
        headers: { accept: 'application/octet-stream', authorization: `Bearer ${token}` },
        redirect: 'follow', signal: controller.signal,
      });
      if (!response.ok) throw new Error(`GitHub asset download failed: ${response.status} ${asset.name}`);
      await pipeline(response.body, createWriteStream(destination));
      clearTimeout(timeout);
      return;
    } catch (error) {
      clearTimeout(timeout);
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  if (!response?.ok) throw new Error(`GitHub asset download failed: ${response?.status ?? 'unknown'} ${asset.name}`);
}

async function fileDigest(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of (await import('node:fs')).createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function migrateRelease(client, release, root, token) {
  const input = githubReleaseToCnbInput(release);
  process.stdout.write(`prepare ${input.tagName}\n`);
  let target;
  try {
    target = await client.getReleaseByTag(input.tagName);
  } catch (error) {
    if (!/CNB API request failed: 404/.test(error.message)) throw error;
    target = await client.createRelease({ ...input, targetCommitish: input.tagName });
  }
  if (!releaseMetadataMatches(release, target)) {
    target = await client.patchRelease(target.id, {
      name: input.name,
      body: input.body,
      draft: input.draft,
      isPrerelease: input.isPrerelease,
      makeLatest: 'false',
    });
  }
  const assets = releaseAssetMap(target);
  for (const sourceAsset of release.assets ?? []) {
    const localName = migrationAssetName(input.tagName, sourceAsset.name);
    const existing = assets.get(localName);
    const oldPrefixed = assets.get(`${input.tagName}-${localName}`);
    const expected = githubAssetDigest(sourceAsset);
    if (oldPrefixed?.id) await client.deleteAsset(target.id, oldPrefixed.id);
    if (existing?.digest === `sha256:${expected}` && existing.size === sourceAsset.size
      && existing.state === 'uploaded') {
      process.stdout.write(`skip ${input.tagName}/${sourceAsset.name}\n`);
      continue;
    }
    const destination = join(root, `${input.tagName}-${localName}`);
    await downloadGithubAsset(sourceAsset, destination, token);
    const digest = await fileDigest(destination);
    if (digest !== expected || statSync(destination).size !== sourceAsset.size) {
      throw new Error(`GitHub asset digest or size mismatch: ${input.tagName}/${sourceAsset.name}`);
    }
    if (existing?.id && !existing.digest) await client.deleteAsset(target.id, existing.id);
    const normalized = join(root, localName);
    await (await import('node:fs/promises')).copyFile(destination, normalized);
    await client.uploadAsset(target.id, normalized, { overwrite: true, ttl: 0 });
    await client.verifyAsset(input.tagName, normalized);
    process.stdout.write(`migrated ${input.tagName}/${sourceAsset.name}\n`);
  }
}

async function main() {
  const selectedTag = process.env.MIGRATE_TAG;
  process.stdout.write(`load GitHub release metadata${selectedTag ? `: ${selectedTag}` : ''}\n`);
  const releases = selectedTag
    ? [await githubJson(`/repos/${sourceRepo}/releases/tags/${encodeURIComponent(selectedTag)}`)]
    : await githubJson(`/repos/${sourceRepo}/releases?per_page=100`);
  const root = mkdtempSync(join(tmpdir(), 'b860-github-release-migration-'));
  const client = createCnbReleaseClient({ repo: cnbRepo });
  process.stdout.write(`loaded ${releases.length} GitHub release(s)\n`);
  for (const release of [...releases].reverse()) await migrateRelease(client, release, root, process.env.GITHUB_TOKEN ?? '');
  const latest = selectedTag ? null : await githubJson(`/repos/${sourceRepo}/releases/latest`);
  if (latest?.tag_name) {
    const target = await client.getReleaseByTag(latest.tag_name);
    await client.patchRelease(target.id, { makeLatest: 'true' });
  }
  process.stdout.write(`migrated ${releases.length} releases from ${sourceRepo} to ${cnbRepo}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
