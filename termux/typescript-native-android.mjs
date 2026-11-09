#!/usr/bin/env node
// Makes the native TypeScript 7 compiler run in Termux on Android, for local typecheck and tests.
//
// @typescript/native has no android-arm64 package. The linux-arm64 binary is a static Go program
// that runs on Android, except that its fswatch package calls fanotify_init(2) at start-up, and
// Android's seccomp filter kills the process for that system call (SIGSYS) instead of failing it.
// This script copies the linux-arm64 package to typescript-android-arm64 and changes that one
// syscall number to close(2): close on the flags value fails with EBADF, so fswatch reports
// fanotify as unavailable and uses its other watcher.
//
// Run it from the repository root after each `yarn install`. It changes only node_modules.
import { chmodSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'node_modules', '@typescript');
const source = join(root, 'typescript-linux-arm64');
const target = join(root, 'typescript-android-arm64');
if (!existsSync(source)) {
  console.error(`Missing ${source}; install with: corepack yarn install --ignore-platform`);
  process.exit(1);
}

// FanotifyInit in golang.org/x/sys/unix, arm64:
//   mov x2, #0x106 (fanotify_init)   stp x2, x0, [sp, #0x8]   stp x1, xzr, [sp, #0x18]
const original = Buffer.from('c22080d2' + 'e28300a9' + 'e1ff01a9', 'hex');
// mov x2, #0x39 (close)
const patchedMov = Buffer.from('220780d2', 'hex');

const binary = readFileSync(join(source, 'lib', 'tsc'));
const first = binary.indexOf(original);
if (first < 0 || binary.indexOf(original, first + 1) >= 0) {
  console.error('FanotifyInit was not found exactly once; this TypeScript version needs a new pattern.');
  process.exit(1);
}
patchedMov.copy(binary, first);

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
writeFileSync(join(target, 'lib', 'tsc'), binary);
chmodSync(join(target, 'lib', 'tsc'), 0o755);
const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
pkg.name = '@typescript/typescript-android-arm64';
pkg.os = ['android'];
writeFileSync(join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Patched fanotify_init at offset 0x${first.toString(16)}; installed ${target}`);
