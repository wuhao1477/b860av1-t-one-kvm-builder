import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SHA256 = /^[0-9a-f]{64}$/;
const REPO = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is invalid`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} is invalid`);
  return value;
}

export function releaseAssetDigest(asset) {
  const source = object(asset, 'release asset');
  const value = String(source.digest ?? source.hash_value ?? '').replace(/^sha256:/i, '').toLowerCase();
  if (!SHA256.test(value)) throw new Error('release asset digest is invalid');
  return value;
}

function normalizeAsset(asset) {
  const value = object(asset, 'release asset');
  const rawDigest = value.digest ?? value.hash_value;
  const digest = rawDigest ? releaseAssetDigest(value) : '';
  const size = Number(value.size);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('release asset size is invalid');
  return {
    id: String(value.id ?? ''),
    name: text(value.name, 'release asset name'),
    size,
    digest: digest ? `sha256:${digest}` : '',
    state: String(value.state ?? value.status ?? (digest ? 'uploaded' : '')),
    contentType: String(value.content_type ?? value.contentType ?? ''),
    browserDownloadUrl: String(value.browser_download_url ?? value.brower_download_url ?? ''),
  };
}

export function normalizeCnbRelease(input) {
  const value = object(input, 'CNB release');
  const assets = Array.isArray(value.assets) ? value.assets.map(normalizeAsset) : [];
  return {
    id: String(value.id ?? ''),
    tagName: text(value.tag_name ?? value.tagName, 'release tag'),
    name: String(value.name ?? ''),
    body: String(value.body ?? value.description ?? ''),
    isDraft: boolean(value.draft ?? value.isDraft, 'release draft flag'),
    isPrerelease: boolean(value.prerelease ?? value.isPrerelease, 'release prerelease flag'),
    isLatest: Boolean(value.is_latest ?? value.isLatest),
    makeLatest: String(value.make_latest ?? value.makeLatest ?? ''),
    assets,
  };
}

export function releaseAssetMap(release) {
  const value = object(release, 'release');
  const map = new Map();
  for (const asset of value.assets ?? []) {
    const normalized = asset.name ? asset : normalizeAsset(asset);
    if (map.has(normalized.name)) throw new Error(`release asset is duplicated: ${normalized.name}`);
    map.set(normalized.name, normalized);
  }
  return map;
}

export function releaseTagList(releases) {
  if (!Array.isArray(releases)) throw new TypeError('releases must be an array');
  return releases.map((release) => normalizeCnbRelease(release).tagName);
}

function responseData(value) {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'data')
    && !Array.isArray(value.data)) return value.data;
  return value;
}

function apiError(response) {
  return new Error(`CNB API request failed: ${response.status}`);
}

function contentTypeFor(filePath) {
  const types = {
    '.gz': 'application/gzip',
    '.img': 'application/octet-stream',
    '.json': 'application/json',
    '.log': 'text/plain',
    '.md': 'text/markdown',
    '.sha256': 'text/plain',
    '.txt': 'text/plain',
    '.xz': 'application/x-xz',
  };
  return types[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function verifyUrlParts(verifyUrl) {
  const url = new URL(text(verifyUrl, 'CNB upload confirmation URL'));
  const marker = '/asset-upload-confirmation/';
  const index = url.pathname.indexOf(marker);
  if (index < 0) throw new Error('CNB upload confirmation URL is invalid');
  const parts = url.pathname.slice(index + marker.length).split('/');
  if (parts.length < 2 || parts.some((part) => part.length === 0)) {
    throw new Error('CNB upload confirmation URL is invalid');
  }
  return {
    uploadToken: decodeURIComponent(parts.shift()),
    assetPath: parts.map((part) => decodeURIComponent(part)).join('/'),
  };
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function normalizeBaseUrl(value) {
  const baseUrl = text(value, 'CNB API base URL').replace(/\/+$/, '');
  new URL(baseUrl);
  return baseUrl;
}

export function createCnbReleaseClient({ baseUrl, repo, token, fetchImpl = fetch } = {}) {
  const apiBase = normalizeBaseUrl(baseUrl ?? process.env.CNB_API_ENDPOINT ?? 'https://api.cnb.cool');
  const repository = text(repo ?? process.env.CNB_REPO_SLUG, 'CNB repository');
  if (!REPO.test(repository)) throw new TypeError('CNB repository is invalid');
  const accessToken = text(token ?? process.env.CNB_TOKEN, 'CNB token');

  async function request(path, options = {}) {
    if (process.env.CNB_RELEASE_DEBUG === 'true') {
      process.stdout.write(`CNB release request: ${options.method ?? 'GET'} ${path}\n`);
    }
    const headers = {
      Accept: 'application/vnd.cnb.api+json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response;
    try {
      response = await fetchImpl(`${apiBase}/${repository}${path}`, {
        ...options,
        headers,
        signal: options.signal ?? controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw apiError(response);
    return response;
  }

  async function readJson(path, options) {
    return responseData(await (await request(path, options)).json());
  }

  async function listReleases() {
    const releases = [];
    for (let page = 1; ; page += 1) {
      const value = await readJson(`/-/releases?page=${page}&page_size=100`);
      if (!Array.isArray(value) || value.length === 0) break;
      releases.push(...value.map(normalizeCnbRelease));
      if (value.length < 100) break;
    }
    return releases;
  }

  async function getReleaseByTag(tag) {
    return normalizeCnbRelease(await readJson(`/-/releases/tags/${encodeURIComponent(text(tag, 'release tag'))}`));
  }

  async function getReleaseById(id) {
    return normalizeCnbRelease(await readJson(`/-/releases/${encodeURIComponent(text(id, 'release id'))}`));
  }

  async function createRelease(input) {
    const value = object(input, 'release input');
    const body = JSON.stringify({
      tag_name: text(value.tagName, 'release tag'),
      target_commitish: text(value.targetCommitish, 'release target commit'),
      name: String(value.name ?? value.tagName),
      body: String(value.body ?? ''),
      draft: Boolean(value.draft),
      prerelease: Boolean(value.isPrerelease),
      make_latest: value.makeLatest ?? 'false',
    });
    return normalizeCnbRelease(await readJson('/-/releases', { method: 'POST', body }));
  }

  async function patchRelease(id, input) {
    const value = object(input, 'release patch');
    const body = JSON.stringify(Object.fromEntries([
      ['name', value.name],
      ['body', value.body],
      ['draft', value.draft],
      ['prerelease', value.isPrerelease ?? value.prerelease],
      ['make_latest', value.makeLatest ?? value.make_latest],
    ].filter(([, entry]) => entry !== undefined)));
    const response = await request(`/-/releases/${encodeURIComponent(text(id, 'release id'))}`, {
      method: 'PATCH',
      body,
    });
    const raw = await response.text();
    if (raw.trim() === '') return getReleaseById(id);
    return normalizeCnbRelease(responseData(JSON.parse(raw)));
  }

  async function deleteAsset(releaseId, assetId) {
    await request(`/-/releases/${encodeURIComponent(text(releaseId, 'release id'))}/assets/${encodeURIComponent(text(assetId, 'asset id'))}`, {
      method: 'DELETE',
    });
  }

  async function downloadAsset(tag, name, destination) {
    const response = await request(`/-/releases/download/${encodeURIComponent(text(tag, 'release tag'))}/${encodeURIComponent(text(name, 'asset name'))}`, {
      headers: { Accept: '*/*' },
      redirect: 'follow',
    });
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
    return destination;
  }

  async function uploadAsset(releaseId, filePath, { overwrite = false, ttl = 0 } = {}) {
    const size = statSync(filePath).size;
    const name = basename(filePath);
    const upload = await readJson(`/-/releases/${encodeURIComponent(text(releaseId, 'release id'))}/asset-upload-url`, {
      method: 'POST',
      body: JSON.stringify({ asset_name: name, size, overwrite, ttl }),
    });
    const uploadUrl = text(upload.upload_url, 'CNB upload URL');
    const confirmation = verifyUrlParts(upload.verify_url);
    const stream = createReadStream(filePath);
    const result = await fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentTypeFor(filePath), 'Content-Length': String(size) },
      body: stream,
      duplex: 'half',
    });
    if (!result.ok) throw new Error(`CNB asset upload failed: ${result.status}`);
    await request(`/-/releases/${encodeURIComponent(releaseId)}/asset-upload-confirmation/${encodeURIComponent(confirmation.uploadToken)}/${confirmation.assetPath.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
    });
    return { name, size, digest: await sha256File(filePath) };
  }

  async function verifyAsset(tag, filePath) {
    const release = await getReleaseByTag(tag);
    const name = basename(filePath);
    const asset = releaseAssetMap(release).get(name);
    if (!asset) throw new Error(`CNB release asset is missing: ${name}`);
    const digest = await sha256File(filePath);
    if (asset.size !== statSync(filePath).size || releaseAssetDigest(asset) !== digest) {
      throw new Error(`CNB release asset does not match local file: ${name}`);
    }
    return asset;
  }

  async function publishRelease(input, files) {
    const value = object(input, 'release publish input');
    const paths = Array.isArray(files) ? files : [];
    if (paths.length === 0) throw new Error('release publish requires assets');
    const metadata = {
      tagName: text(value.tagName, 'release tag'),
      targetCommitish: text(value.targetCommitish, 'release target commit'),
      name: String(value.name ?? value.tagName),
      body: String(value.body ?? ''),
      isPrerelease: Boolean(value.isPrerelease),
      makeLatest: value.makeLatest ?? 'false',
    };
    let release;
    try {
      release = await getReleaseByTag(metadata.tagName);
    } catch (error) {
      if (!/CNB API request failed: 404/.test(error.message)) throw error;
      release = await createRelease({ ...metadata, draft: true });
    }
    if (release.name !== metadata.name || release.body !== metadata.body
      || release.isPrerelease !== metadata.isPrerelease) {
      release = await patchRelease(release.id, metadata);
    }
    for (const filePath of paths) {
      const name = basename(filePath);
      const localSize = statSync(filePath).size;
      const localDigest = await sha256File(filePath);
      const current = releaseAssetMap(release).get(name);
      if (!current || current.size !== localSize || current.digest !== `sha256:${localDigest}`
        || current.state !== 'uploaded') {
        if (current?.id) await deleteAsset(release.id, current.id);
        await uploadAsset(release.id, filePath, { overwrite: true, ttl: 0 });
      }
      release = await getReleaseByTag(metadata.tagName);
      const verified = releaseAssetMap(release).get(name);
      if (!verified || verified.size !== localSize || verified.digest !== `sha256:${localDigest}`
        || verified.state !== 'uploaded') {
        throw new Error(`CNB release asset did not verify: ${name}`);
      }
    }
    if (release.isDraft || release.makeLatest !== metadata.makeLatest) {
      release = await patchRelease(release.id, {
        draft: false,
        isPrerelease: metadata.isPrerelease,
        makeLatest: metadata.makeLatest,
      });
    }
    return release;
  }

  return {
    listReleases,
    getReleaseByTag,
    getReleaseById,
    createRelease,
    patchRelease,
    deleteAsset,
    downloadAsset,
    uploadAsset,
    verifyAsset,
    publishRelease,
  };
}
