import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createCnbReleaseClient,
  normalizeCnbRelease,
  releaseAssetDigest,
  releaseAssetMap,
} from '../src/cnb-release.mjs';

const cnbRelease = {
  id: '123',
  tag_name: 'v1.2.0',
  name: 'B860 release',
  body: 'Release notes',
  draft: false,
  prerelease: true,
  make_latest: 'false',
  assets: [
    {
      id: '456',
      name: 'image.img.xz',
      size: 12,
      digest: 'sha256:ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
      state: 'uploaded',
    },
  ],
};

test('normalizes CNB release metadata to the existing release contract', () => {
  assert.deepEqual(normalizeCnbRelease(cnbRelease), {
    id: '123',
    tagName: 'v1.2.0',
    name: 'B860 release',
    body: 'Release notes',
    isDraft: false,
    isPrerelease: true,
    isLatest: false,
    makeLatest: 'false',
    assets: [{
      id: '456',
      name: 'image.img.xz',
      size: 12,
      digest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      state: 'uploaded',
      contentType: '',
      browserDownloadUrl: '',
    }],
  });
});

test('keeps incomplete CNB assets readable without treating them as verified', () => {
  const release = normalizeCnbRelease({
    ...cnbRelease,
    assets: [{ id: '789', name: 'partial.bin', size: 12 }],
  });
  assert.equal(release.assets[0].digest, '');
  assert.equal(releaseAssetMap(release).get('partial.bin').digest, '');
  assert.throws(() => releaseAssetDigest(release.assets[0]), /digest/i);
});

test('treats a CNB asset with hash_value but no state as uploaded', () => {
  const release = normalizeCnbRelease({
    ...cnbRelease,
    assets: [{ name: 'complete.bin', size: 1, hash_value: `sha256:${'b'.repeat(64)}` }],
  });
  assert.equal(release.assets[0].state, 'uploaded');
});

test('rejects duplicate release assets and normalizes asset digests', () => {
  const release = normalizeCnbRelease(cnbRelease);
  release.assets.push({ ...release.assets[0], id: '789' });
  assert.throws(() => releaseAssetMap(release), /duplicate/i);
  assert.equal(releaseAssetDigest(cnbRelease.assets[0]), 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
  assert.throws(() => releaseAssetDigest({ digest: 'sha256:not-a-digest' }), /digest/i);
  assert.equal(releaseAssetDigest({ hash_value: `sha256:${'a'.repeat(64)}` }), 'a'.repeat(64));
});

test('client lists and reads CNB releases through the configured API', async (t) => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    if (request.url.startsWith('/wuhao1477/repo/-/releases?')) {
      response.end(JSON.stringify([cnbRelease]));
      return;
    }
    if (request.url === '/wuhao1477/repo/-/releases/tags/v1.2.0') {
      response.end(JSON.stringify(cnbRelease));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ errmsg: 'missing' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const client = createCnbReleaseClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repo: 'wuhao1477/repo',
    token: 'test-token',
  });
  assert.deepEqual((await client.listReleases()).map((release) => release.tagName), ['v1.2.0']);
  assert.equal((await client.getReleaseByTag('v1.2.0')).tagName, 'v1.2.0');
  assert.deepEqual(requests, [
    {
      method: 'GET',
      url: '/wuhao1477/repo/-/releases?page=1&page_size=100',
      authorization: 'Bearer test-token',
    },
    {
      method: 'GET',
      url: '/wuhao1477/repo/-/releases/tags/v1.2.0',
      authorization: 'Bearer test-token',
    },
  ]);
});

test('hides token and response body details in API errors', async (t) => {
  const server = http.createServer((_request, response) => {
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ errmsg: 'secret-token-value' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const client = createCnbReleaseClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repo: 'wuhao1477/repo',
    token: 'secret-token-value',
  });
  await assert.rejects(
    () => client.getReleaseByTag('v1.2.0'),
    (error) => error instanceof Error
      && /CNB API request failed: 500/.test(error.message)
      && !error.message.includes('secret-token-value'),
  );
});

test('uploads and downloads an asset through CNB presigned URLs', async (t) => {
  const events = [];
  const directory = mkdtempSync(join(tmpdir(), 'cnb-release-test-'));
  const source = join(directory, 'notes.txt');
  const destination = join(directory, 'downloaded.txt');
  writeFileSync(source, 'migration payload\n');
  const server = http.createServer((request, response) => {
    if (request.url === '/wuhao1477/repo/-/releases/123/asset-upload-url') {
      events.push({ method: request.method, body: '' });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        upload_url: `http://127.0.0.1:${server.address().port}/upload`,
        verify_url: `http://127.0.0.1:${server.address().port}/wuhao1477/repo/-/releases/123/asset-upload-confirmation/token/path/notes.txt`,
      }));
      return;
    }
    if (request.url === '/upload') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        events.push({ method: request.method, body: Buffer.concat(chunks).toString() });
        response.statusCode = 200;
        response.end();
      });
      return;
    }
    if (request.url === '/wuhao1477/repo/-/releases/123/asset-upload-confirmation/token/path/notes.txt') {
      events.push({ method: request.method, body: '' });
      response.statusCode = 200;
      response.end('{}');
      return;
    }
    if (request.url === '/wuhao1477/repo/-/releases/download/v1.2.0/notes.txt') {
      response.statusCode = 200;
      response.end('migration payload\n');
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const client = createCnbReleaseClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repo: 'wuhao1477/repo',
    token: 'test-token',
  });
  assert.deepEqual(await client.uploadAsset('123', source), {
    name: 'notes.txt',
    size: 18,
    digest: '8c453a2afcc3eeb26b10a61e09f2f12eedf5b42d07fce039456187d8c1290c91',
  });
  await client.downloadAsset('v1.2.0', 'notes.txt', destination);
  assert.equal(readFileSync(destination, 'utf8'), 'migration payload\n');
  assert.deepEqual(events.map(({ method, body }) => [method, body]), [
    ['POST', ''],
    ['PUT', 'migration payload\n'],
    ['POST', ''],
  ]);
});

test('publishes a release idempotently and only exposes it after assets verify', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cnb-release-publish-test-'));
  const bodyFile = join(directory, 'body.md');
  const source = join(directory, 'notes.txt');
  writeFileSync(bodyFile, 'release notes\n');
  writeFileSync(source, 'migration payload\n');
  const digest = '8c453a2afcc3eeb26b10a61e09f2f12eedf5b42d07fce039456187d8c1290c91';
  let release;
  const methods = [];
  const server = http.createServer((request, response) => {
    methods.push(`${request.method} ${request.url}`);
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && request.url === '/wuhao1477/repo/-/releases/tags/v2.0.0') {
      if (!release) {
        response.statusCode = 404;
        response.end('{}');
      } else response.end(JSON.stringify(release));
      return;
    }
    if (request.method === 'POST' && request.url === '/wuhao1477/repo/-/releases') {
      release = {
        id: '987', tag_name: 'v2.0.0', name: 'Release', body: 'release notes\n',
        draft: true, prerelease: true, make_latest: 'false', assets: [],
      };
      response.end(JSON.stringify(release));
      return;
    }
    if (request.method === 'POST' && request.url === '/wuhao1477/repo/-/releases/987/asset-upload-url') {
      response.end(JSON.stringify({
        upload_url: `http://127.0.0.1:${server.address().port}/upload`,
        verify_url: `http://127.0.0.1:${server.address().port}/wuhao1477/repo/-/releases/987/asset-upload-confirmation/token/notes.txt`,
      }));
      return;
    }
    if (request.method === 'PUT' && request.url === '/upload') {
      request.resume();
      request.on('end', () => response.end());
      return;
    }
    if (request.method === 'POST' && request.url === '/wuhao1477/repo/-/releases/987/asset-upload-confirmation/token/notes.txt') {
      release.assets = [{ id: '654', name: 'notes.txt', size: 18, hash_value: digest, state: 'uploaded' }];
      response.end('{}');
      return;
    }
    if (request.method === 'PATCH' && request.url === '/wuhao1477/repo/-/releases/987') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        Object.assign(release, JSON.parse(body));
        release.draft = false;
        response.end(JSON.stringify(release));
      });
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const client = createCnbReleaseClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repo: 'wuhao1477/repo',
    token: 'test-token',
  });
  const result = await client.publishRelease({
    tagName: 'v2.0.0',
    targetCommitish: 'main',
    name: 'Release',
    body: 'release notes\n',
    isPrerelease: true,
  }, [source]);
  assert.equal(result.isDraft, false);
  assert.equal(result.assets[0].digest, `sha256:${digest}`);
  assert.deepEqual(methods, [
    'GET /wuhao1477/repo/-/releases/tags/v2.0.0',
    'POST /wuhao1477/repo/-/releases',
    'POST /wuhao1477/repo/-/releases/987/asset-upload-url',
    'PUT /upload',
    'POST /wuhao1477/repo/-/releases/987/asset-upload-confirmation/token/notes.txt',
    'GET /wuhao1477/repo/-/releases/tags/v2.0.0',
    'PATCH /wuhao1477/repo/-/releases/987',
  ]);
});

test('patchRelease accepts CNB empty-body success responses', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.method === 'PATCH') {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === 'GET') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        id: '123', tag_name: 'v1.2.0', name: 'patched', body: '',
        draft: false, prerelease: false, assets: [],
      }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const client = createCnbReleaseClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repo: 'wuhao1477/repo',
    token: 'test-token',
  });
  assert.equal((await client.patchRelease('123', { name: 'patched' })).name, 'patched');
});
