import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const root = fileURLToPath(new URL('..', import.meta.url));
const audit = join(root, 'scripts/audit-public-releases.sh');

const fakeNode = `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$NODE_LOG"
[[ "\${NODE_MODE:-empty}" != fail ]] || exit 1
printf '%s\n' 'public release audit: no published Armbian prereleases'
`;

const fakeSleep = `#!/usr/bin/env bash
exit 0
`;

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'b860-release-audit-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const node = join(bin, 'node');
  const sleep = join(bin, 'sleep');
  await writeFile(node, fakeNode);
  await writeFile(sleep, fakeSleep);
  await chmod(node, 0o755);
  await chmod(sleep, 0o755);
  return { bin, directory, log: join(directory, 'node.log') };
}

function environment(paths, mode) {
  return {
    ...process.env,
    NODE_LOG: paths.log,
    NODE_MODE: mode,
    CNB_REPO_SLUG: 'owner/repository',
    CNB_TOKEN: 'test-token',
    PATH: `${paths.bin}:${process.env.PATH}`,
  };
}

test('public release audit accepts an empty CNB repository', async () => {
  const paths = await setup();
  try {
    const { stdout } = await execFile(audit, [], { cwd: root, env: environment(paths, 'empty') });
    assert.match(stdout, /no published Armbian prereleases/);
    assert.match(await readFile(paths.log, 'utf8'), /scripts\/cnb-release-audit\.mjs/);
  } finally {
    await rm(paths.directory, { recursive: true, force: true });
  }
});

test('public release audit fails closed when the CNB audit fails', async () => {
  const paths = await setup();
  try {
    await assert.rejects(
      execFile(audit, [], { cwd: root, env: environment(paths, 'fail') }),
      (error) => error.code === 1,
    );
    assert.match(await readFile(paths.log, 'utf8'), /scripts\/cnb-release-audit\.mjs/);
  } finally {
    await rm(paths.directory, { recursive: true, force: true });
  }
});

test('public release audit delegates project Release access to CNB', async () => {
  const source = await readFile(audit, 'utf8');
  assert.match(source, /CNB_REPO_SLUG/);
  assert.match(source, /cnb-release-audit\.mjs/);
  assert.doesNotMatch(source, /gh release/);
});
