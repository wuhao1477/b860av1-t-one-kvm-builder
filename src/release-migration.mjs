import { basename } from 'node:path';

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  return value;
}

export function githubAssetDigest(asset) {
  const value = String(object(asset, 'GitHub asset').digest ?? '').replace(/^sha256:/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('GitHub asset digest is missing or invalid');
  return value;
}

export function githubReleaseToCnbInput(release) {
  const value = object(release, 'GitHub release');
  return {
    tagName: text(value.tag_name, 'GitHub release tag'),
    targetCommitish: text(value.target_commitish || value.tag_name, 'GitHub release target'),
    name: text(value.name || value.tag_name, 'GitHub release name'),
    body: String(value.body ?? ''),
    draft: value.draft === true,
    isPrerelease: value.prerelease === true,
    makeLatest: value.make_latest === 'true' || value.is_latest === true ? 'true' : 'false',
  };
}

export function releaseMetadataMatches(githubRelease, cnbRelease) {
  const source = githubReleaseToCnbInput(githubRelease);
  const target = object(cnbRelease, 'CNB release');
  return source.tagName === target.tagName
    && source.name === target.name
    && source.body === target.body
    && source.draft === target.isDraft
    && source.isPrerelease === target.isPrerelease;
}

export function migrationAssetName(_tag, sourceName) {
  return basename(sourceName);
}
