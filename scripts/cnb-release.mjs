#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import {
  createCnbReleaseClient,
  releaseAssetMap,
} from '../src/cnb-release.mjs';

function usage() {
  process.stderr.write(`usage:
  cnb-release.mjs list
  cnb-release.mjs get <tag>
  cnb-release.mjs download <tag> <asset> <destination>
  cnb-release.mjs create <tag> <target-commitish> <name> <body-file> <draft> <prerelease> <make-latest>
  cnb-release.mjs upload <release-id> <file> [overwrite]
  cnb-release.mjs publish <tag> <target-commitish> <name> <body-file> <prerelease> <make-latest> <file> [...files]
  cnb-release.mjs verify <tag> <file> [...files]
`);
  process.exitCode = 2;
}

function bool(value, label) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${label} must be true or false`);
}

function client() {
  return createCnbReleaseClient();
}

async function main(args) {
  const [command, ...values] = args;
  const api = client();
  if (command === 'list' && values.length === 0) {
    process.stdout.write(`${JSON.stringify(await api.listReleases(), null, 2)}\n`);
    return;
  }
  if (command === 'get' && values.length === 1) {
    process.stdout.write(`${JSON.stringify(await api.getReleaseByTag(values[0]), null, 2)}\n`);
    return;
  }
  if (command === 'download' && values.length === 3) {
    await api.downloadAsset(values[0], values[1], values[2]);
    return;
  }
  if (command === 'create' && values.length === 7) {
    const [tagName, targetCommitish, name, bodyFile, draft, prerelease, makeLatest] = values;
    const release = await api.createRelease({
      tagName,
      targetCommitish,
      name,
      body: readFileSync(bodyFile, 'utf8'),
      draft: bool(draft, 'draft'),
      isPrerelease: bool(prerelease, 'prerelease'),
      makeLatest,
    });
    process.stdout.write(`${JSON.stringify(release, null, 2)}\n`);
    return;
  }
  if (command === 'upload' && (values.length === 2 || values.length === 3)) {
    const result = await api.uploadAsset(values[0], values[1], { overwrite: values[2] === 'true' });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'publish' && values.length >= 7) {
    const [tagName, targetCommitish, name, bodyFile, prerelease, makeLatest, ...files] = values;
    const release = await api.publishRelease({
      tagName,
      targetCommitish,
      name,
      body: readFileSync(bodyFile, 'utf8'),
      isPrerelease: bool(prerelease, 'prerelease'),
      makeLatest,
    }, files);
    process.stdout.write(`${JSON.stringify(release, null, 2)}\n`);
    return;
  }
  if (command === 'verify' && values.length >= 2) {
    const [tag, ...files] = values;
    const results = [];
    for (const file of files) results.push(await api.verifyAsset(tag, file));
    const release = await api.getReleaseByTag(tag);
    if (releaseAssetMap(release).size < files.length) throw new Error('CNB release asset count is smaller than requested files');
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }
  usage();
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
