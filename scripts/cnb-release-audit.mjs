#!/usr/bin/env node

import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { createCnbReleaseClient } from '../src/cnb-release.mjs';
import { validatePublicRelease } from '../src/public-release-policy.mjs';

const repo = process.env.CNB_REPO_SLUG;
const client = createCnbReleaseClient({ repo });
const root = mkdtempSync(join(tmpdir(), 'b860-cnb-release-audit-'));

async function main() {
  const releases = await client.listReleases();
  const candidates = releases.filter((release) => !release.isDraft
    && release.isPrerelease && release.tagName.startsWith('armbian-'));
  for (const release of candidates) {
    const directory = join(root, release.tagName);
    await mkdir(directory, { recursive: true });
    for (const name of ['resolved-sources.json', 'validation-report.json']) {
      await client.downloadAsset(release.tagName, name, join(directory, name));
    }
    validatePublicRelease({
      manifest: JSON.parse(await readFile(join(directory, 'resolved-sources.json'), 'utf8')),
      report: JSON.parse(await readFile(join(directory, 'validation-report.json'), 'utf8')),
      release,
      tag: release.tagName,
    });
    process.stdout.write(`public release audit: ${release.tagName}\n`);
  }
  if (candidates.length === 0) process.stdout.write('public release audit: no published Armbian prereleases\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
