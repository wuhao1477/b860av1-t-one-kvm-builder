import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDebugfsCommands,
  diffRootfsTrees,
  syncRootfsTree,
} from '../scripts/sync-rootfs-tree.mjs';

function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'b860-sync-rootfs-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const before = path.join(directory, 'before');
  const after = path.join(directory, 'after');
  fs.mkdirSync(path.join(before, 'etc'), { recursive: true });
  fs.mkdirSync(path.join(after, 'etc'), { recursive: true });
  fs.mkdirSync(path.join(before, 'usr'), { recursive: true });
  fs.mkdirSync(path.join(after, 'usr'), { recursive: true });
  fs.writeFileSync(path.join(before, 'etc', 'keep'), 'same');
  fs.writeFileSync(path.join(after, 'etc', 'keep'), 'same');
  fs.writeFileSync(path.join(before, 'etc', 'remove'), 'gone');
  fs.writeFileSync(path.join(before, 'etc', 'change'), 'old');
  fs.writeFileSync(path.join(after, 'etc', 'change'), 'new');
  fs.mkdirSync(path.join(after, 'usr', 'local', 'sbin'), { recursive: true });
  fs.writeFileSync(path.join(after, 'usr', 'local', 'sbin', 'new-helper'), '#!/bin/sh\n');
  fs.chmodSync(path.join(after, 'usr', 'local', 'sbin', 'new-helper'), 0o755);
  fs.symlinkSync('/etc/keep', path.join(after, 'etc', 'new-link'));
  fs.writeFileSync(path.join(before, 'etc', 'type-change'), 'file');
  fs.mkdirSync(path.join(after, 'etc', 'type-change'));
  const symlinkMode = fs.lstatSync(path.join(after, 'etc', 'new-link')).mode & 0o7777;
  return { before, after, symlinkMode };
}

test('diffRootfsTrees reports only meaningful rootfs changes in sync order', (context) => {
  const { before, after, symlinkMode } = fixture(context);

  assert.deepEqual(
    diffRootfsTrees(before, after).map(({ kind, path: itemPath, type, mode, target }) => ({
      kind,
      path: itemPath,
      ...(type ? { type } : {}),
      ...(mode ? { mode } : {}),
      ...(target ? { target } : {}),
    })),
    [
      { kind: 'remove', path: '/etc/remove' },
      { kind: 'replace', path: '/etc/change', type: 'file', mode: 0o644 },
      { kind: 'replace', path: '/etc/type-change', type: 'directory', mode: 0o755 },
      { kind: 'mkdir', path: '/usr/local', type: 'directory', mode: 0o755 },
      { kind: 'mkdir', path: '/usr/local/sbin', type: 'directory', mode: 0o755 },
      { kind: 'write', path: '/usr/local/sbin/new-helper', type: 'file', mode: 0o755 },
      { kind: 'symlink', path: '/etc/new-link', type: 'symlink', mode: symlinkMode, target: '/etc/keep' },
    ],
  );
});

test('diffRootfsTrees detects ownership and mode changes without timestamps', (context) => {
  const { before, after } = fixture(context);
  const beforeFile = path.join(before, 'etc', 'keep');
  const afterFile = path.join(after, 'etc', 'keep');
  fs.chmodSync(afterFile, 0o640);
  fs.chownSync(afterFile, process.getuid(), process.getgid());
  const beforeMtime = new Date(1_000);
  const afterMtime = new Date(2_000);
  fs.utimesSync(beforeFile, beforeMtime, beforeMtime);
  fs.utimesSync(afterFile, afterMtime, afterMtime);

  const change = diffRootfsTrees(before, after).find((item) => item.path === '/etc/keep');

  assert.equal(change.kind, 'replace');
  assert.equal(change.type, 'file');
  assert.equal(change.mode, 0o640);
});

test('diffRootfsTrees rejects unsafe names and special files', (context) => {
  const { before, after } = fixture(context);
  fs.writeFileSync(path.join(after, 'etc', 'bad"name'), 'unsafe');

  assert.throws(() => diffRootfsTrees(before, after), /unsafe path component/);
});

test('buildDebugfsCommands preserves inode types when setting modes', (context) => {
  const { before, after, symlinkMode } = fixture(context);
  const commands = buildDebugfsCommands('/tmp/rootfs.ext4', before, after);

  assert.ok(commands.includes('set_inode_field "/usr/local" mode 040755'));
  assert.ok(commands.includes('set_inode_field "/usr/local/sbin/new-helper" mode 0100755'));
  assert.ok(commands.includes(
    `set_inode_field "/etc/new-link" mode 0${(0o120000 | symlinkMode).toString(8)}`,
  ));
});

test('buildDebugfsCommands frees removed non-directory inodes', (context) => {
  const { before, after } = fixture(context);
  const commands = buildDebugfsCommands('/tmp/rootfs.ext4', before, after);

  assert.equal(commands[0], 'rm "/etc/remove"');
  assert.ok(commands.includes('rm "/etc/change"'));
  assert.ok(commands.every((command) => !command.startsWith('unlink ')));
});

test('syncRootfsTree ignores debugfs command echo lines', (context) => {
  const { before, after } = fixture(context);
  const binDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'b860-debugfs-bin-'));
  context.after(() => fs.rmSync(binDirectory, { recursive: true, force: true }));
  const debugfs = path.join(binDirectory, 'debugfs');
  fs.writeFileSync(
    debugfs,
    '#!/bin/sh\nprintf \'%s\\n\' \'debugfs: Filesystem opened read/write\' \'debugfs: mkdir "/usr/local"\' \'debugfs: rm "/etc/remove"\'\n',
  );
  fs.chmodSync(debugfs, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDirectory}${path.delimiter}${previousPath ?? ''}`;
  try {
    assert.doesNotThrow(() => syncRootfsTree('/tmp/rootfs.ext4', before, after));
  } finally {
    process.env.PATH = previousPath;
  }
});

test('syncRootfsTree rejects debugfs command errors', (context) => {
  const { before, after } = fixture(context);
  const binDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'b860-debugfs-bin-'));
  context.after(() => fs.rmSync(binDirectory, { recursive: true, force: true }));
  const debugfs = path.join(binDirectory, 'debugfs');
  fs.writeFileSync(
    debugfs,
    '#!/bin/sh\nprintf \'%s\\n\' \'debugfs: Filesystem opened read/write\' \'debugfs: write: Ext2 inode is not a directory\'\n',
  );
  fs.chmodSync(debugfs, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDirectory}${path.delimiter}${previousPath ?? ''}`;
  try {
    assert.throws(
      () => syncRootfsTree('/tmp/rootfs.ext4', before, after),
      /debugfs failed.*Ext2 inode is not a directory/s,
    );
  } finally {
    process.env.PATH = previousPath;
  }
});
