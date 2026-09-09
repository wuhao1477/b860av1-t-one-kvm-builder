#!/usr/bin/env node

import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH_CHUNK_BYTES = 1024 * 1024;
const UNSAFE_PATH = /["\\\0\r\n]/u;
const TYPES = new Set(['file', 'directory', 'symlink']);

function fail(message) {
  throw new Error(message);
}

function assertSafeComponent(component) {
  if (!component || component === '.' || component === '..' || UNSAFE_PATH.test(component)) {
    fail(`unsafe path component: ${JSON.stringify(component)}`);
  }
}

function assertSafeInternalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value === '//'
      || value.includes('//') || value.split('/').some((component) => component === '..')) {
    fail(`unsafe ext4 path: ${JSON.stringify(value)}`);
  }
  if (value !== '/') {
    for (const component of value.split('/').slice(1)) assertSafeComponent(component);
  }
  return value;
}

function assertSafeCommandValue(value, label) {
  if (typeof value !== 'string' || !value || UNSAFE_PATH.test(value)) {
    fail(`${label} contains unsafe characters`);
  }
  return value;
}

function quote(value, label) {
  assertSafeCommandValue(value, label);
  return `"${value}"`;
}

function modeOf(stat) {
  return stat.mode & 0o7777;
}

function describeNode(hostPath, internalPath) {
  const stat = fs.lstatSync(hostPath);
  if (stat.isBlockDevice() || stat.isCharacterDevice() || stat.isFIFO() || stat.isSocket()) {
    fail(`unsupported special file in rootfs tree: ${internalPath}`);
  }
  let type;
  if (stat.isDirectory()) type = 'directory';
  else if (stat.isFile()) type = 'file';
  else if (stat.isSymbolicLink()) type = 'symlink';
  else fail(`unsupported file type in rootfs tree: ${internalPath}`);
  if (type === 'file' && stat.nlink > 1) {
    fail(`hard-linked regular files are not supported: ${internalPath}`);
  }
  const node = {
    type,
    mode: modeOf(stat),
    uid: stat.uid,
    gid: stat.gid,
  };
  if (type === 'file') node.size = stat.size;
  if (type === 'symlink') {
    node.target = assertSafeCommandValue(fs.readlinkSync(hostPath), 'symlink target');
  }
  return node;
}

function internalChildPath(parent, name) {
  assertSafeComponent(name);
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

function collectTree(rootDir) {
  const root = path.resolve(rootDir);
  if (!fs.statSync(root).isDirectory()) fail(`rootfs tree is not a directory: ${rootDir}`);
  const tree = new Map();

  function visit(hostPath, internalPath) {
    assertSafeInternalPath(internalPath);
    tree.set(internalPath, describeNode(hostPath, internalPath));
    if (tree.get(internalPath).type !== 'directory') return;
    for (const name of fs.readdirSync(hostPath)) {
      visit(path.join(hostPath, name), internalChildPath(internalPath, name));
    }
  }

  visit(root, '/');
  return { root, tree };
}

function sameMetadata(before, after) {
  return before.mode === after.mode && before.uid === after.uid && before.gid === after.gid;
}

function fileDigest(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  try {
    let position = 0;
    let count;
    do {
      count = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (count > 0) hash.update(buffer.subarray(0, count));
      position += count;
    } while (count > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function sameFile(beforeRoot, afterRoot, internalPath, before, after) {
  if (before.size !== after.size) return false;
  const beforePath = internalPathToHost(beforeRoot, internalPath);
  const afterPath = internalPathToHost(afterRoot, internalPath);
  return fileDigest(beforePath) === fileDigest(afterPath);
}

function internalPathToHost(root, internalPath) {
  assertSafeInternalPath(internalPath);
  if (internalPath === '/') return root;
  return path.join(root, ...internalPath.slice(1).split('/'));
}

function operationForNew(internalPath, node) {
  if (node.type === 'directory') return { kind: 'mkdir', path: internalPath, ...node };
  if (node.type === 'file') return { kind: 'write', path: internalPath, ...node };
  return { kind: 'symlink', path: internalPath, ...node };
}

function depth(internalPath) {
  return internalPath === '/' ? 0 : internalPath.split('/').length - 1;
}

function comparePaths(a, b) {
  return a.localeCompare(b, 'en');
}

function sortDeepestFirst(a, b) {
  return depth(b.path) - depth(a.path) || comparePaths(a.path, b.path);
}

function sortShallowestFirst(a, b) {
  return depth(a.path) - depth(b.path) || comparePaths(a.path, b.path);
}

export function diffRootfsTrees(beforeDir, afterDir) {
  const before = collectTree(beforeDir);
  const after = collectTree(afterDir);
  const removes = [];
  const replacements = [];
  const mkdirs = [];
  const writes = [];
  const symlinks = [];
  const metadata = [];

  for (const [internalPath] of before.tree) {
    if (internalPath !== '/' && !after.tree.has(internalPath)) {
      removes.push({ kind: 'remove', path: internalPath });
    }
  }

  for (const [internalPath, afterNode] of after.tree) {
    const beforeNode = before.tree.get(internalPath);
    if (!beforeNode) {
      const operation = operationForNew(internalPath, afterNode);
      if (operation.kind === 'mkdir') mkdirs.push(operation);
      else if (operation.kind === 'write') writes.push(operation);
      else symlinks.push(operation);
      continue;
    }
    if (beforeNode.type !== afterNode.type) {
      replacements.push({ kind: 'replace', path: internalPath, ...afterNode });
      continue;
    }
    if (afterNode.type === 'file'
        && (!sameMetadata(beforeNode, afterNode)
          || !sameFile(before.root, after.root, internalPath, beforeNode, afterNode))) {
      replacements.push({ kind: 'replace', path: internalPath, ...afterNode });
    } else if (afterNode.type === 'symlink'
        && (!sameMetadata(beforeNode, afterNode) || beforeNode.target !== afterNode.target)) {
      replacements.push({ kind: 'replace', path: internalPath, ...afterNode });
    } else if (afterNode.type === 'directory' && !sameMetadata(beforeNode, afterNode)) {
      metadata.push({ kind: 'metadata', path: internalPath, ...afterNode });
    }
  }

  return [
    ...removes.sort(sortDeepestFirst),
    ...replacements.sort(sortShallowestFirst),
    ...mkdirs.sort(sortShallowestFirst),
    ...writes.sort((a, b) => comparePaths(a.path, b.path)),
    ...symlinks.sort((a, b) => comparePaths(a.path, b.path)),
    ...metadata.sort(sortShallowestFirst),
  ];
}

function modeText(mode) {
  return `0${mode.toString(8)}`;
}

function inodeMode(node) {
  const typeBits = {
    file: 0o100000,
    directory: 0o040000,
    symlink: 0o120000,
  }[node.type];
  if (!typeBits) fail(`unsupported inode type: ${node.type}`);
  return typeBits | node.mode;
}

function inodeCommands(internalPath, node) {
  return [
    `set_inode_field ${quote(internalPath, 'ext4 path')} mode ${modeText(inodeMode(node))}`,
    `set_inode_field ${quote(internalPath, 'ext4 path')} uid ${node.uid}`,
    `set_inode_field ${quote(internalPath, 'ext4 path')} gid ${node.gid}`,
  ];
}

function createCommands(afterRoot, operation) {
  const hostPath = internalPathToHost(afterRoot, operation.path);
  if (operation.kind === 'mkdir') {
    return [`mkdir ${quote(operation.path, 'ext4 path')}`, ...inodeCommands(operation.path, operation)];
  }
  if (operation.kind === 'write') {
    return [
      `write ${quote(hostPath, 'host path')} ${quote(operation.path, 'ext4 path')}`,
      ...inodeCommands(operation.path, operation),
    ];
  }
  if (operation.kind === 'symlink') {
    return [
      `symlink ${quote(operation.path, 'ext4 path')} ${quote(operation.target, 'symlink target')}`,
      ...inodeCommands(operation.path, operation),
    ];
  }
  fail(`unsupported rootfs create operation: ${operation.kind}`);
}

function removeCommand(beforeNode, internalPath) {
  const command = beforeNode.type === 'directory' ? 'rmdir' : 'rm';
  return `${command} ${quote(internalPath, 'ext4 path')}`;
}

export function buildDebugfsCommands(imagePath, beforeDir, afterDir, operations = diffRootfsTrees(beforeDir, afterDir)) {
  const before = collectTree(beforeDir).tree;
  const afterRoot = collectTree(afterDir).root;
  const commands = [];
  for (const operation of operations) {
    if (operation.kind === 'remove') {
      commands.push(removeCommand(before.get(operation.path), operation.path));
    } else if (operation.kind === 'replace') {
      commands.push(removeCommand(before.get(operation.path), operation.path));
      commands.push(...createCommands(afterRoot, { ...operation, kind: operation.type === 'directory' ? 'mkdir' : operation.type === 'file' ? 'write' : 'symlink' }));
    } else if (operation.kind === 'metadata') {
      commands.push(...inodeCommands(operation.path, operation));
    } else {
      commands.push(...createCommands(afterRoot, operation));
    }
  }
  return commands;
}

export function syncRootfsTree(imagePath, beforeDir, afterDir) {
  const operations = diffRootfsTrees(beforeDir, afterDir);
  if (operations.length === 0) return operations;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'b860-rootfs-sync-'));
  const commandFile = path.join(temporaryDirectory, 'debugfs.commands');
  try {
    const commands = buildDebugfsCommands(imagePath, beforeDir, afterDir, operations);
    fs.writeFileSync(commandFile, `${commands.join('\n')}\n`, 'utf8');
    const result = childProcess.spawnSync(
      'debugfs',
      ['-w', '-f', commandFile, imagePath],
      { encoding: 'utf8' },
    );
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const errors = output.split(/\r?\n/u).filter((line) => {
      const match = line.match(/^debugfs:\s*(.+)$/u);
      if (!match) return false;
      const message = match[1].trim();
      return !message.startsWith('Filesystem opened')
        && !/^(?:mkdir|write|symlink|rm|rmdir|set_inode_field)(?:\s|$)/u.test(message);
    });
    if (result.error || result.status !== 0 || errors.length > 0) {
      const detail = [...errors, ...output.split(/\r?\n/u).filter((line) => line.trim())]
        .slice(-4)
        .join('\n');
      throw new Error(`debugfs failed for ${imagePath}${detail ? `: ${detail}` : ''}`);
    }
    return operations;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function main() {
  const [imagePath, beforeDir, afterDir] = process.argv.slice(2);
  if (!imagePath || !beforeDir || !afterDir) {
    process.stderr.write('usage: sync-rootfs-tree.mjs image.ext4 before-tree after-tree\n');
    process.exitCode = 2;
    return;
  }
  try {
    const operations = syncRootfsTree(imagePath, beforeDir, afterDir);
    process.stdout.write(`${JSON.stringify({ operations: operations.length })}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
