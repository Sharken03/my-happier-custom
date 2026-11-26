import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile, utimes, rename, symlink, unlink } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { createProbeTempDir, writeExecutableScript } from '@/capabilities/probes/agentModelsProbe.testkit';
import { createEnvKeyScope } from '@/testkit/env/envScope';

const processBoundary = vi.hoisted(() => ({ calls: 0, version: '1.2.3', wait: Promise.resolve(), beforeProbe: null as (() => Promise<void>) | null }));

// Only OS process execution is replaced; provider catalog, resolution and filesystem stay real.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: async (file: string, args: readonly string[] = []) => {
      // A node script launcher runs as `node <script> --version`.
      const provider = file.includes('opencode') || String(args[0] ?? '').includes('opencode');
      if (provider) {
        processBoundary.calls++;
        await processBoundary.beforeProbe?.();
      }
      const version = processBoundary.version;
      if (provider) await processBoundary.wait;
      return { stdout: version ? `opencode ${version}\n` : 'no version\n', stderr: '' };
    },
  });
  return { ...actual, execFile };
});

afterEach(() => { vi.useRealTimers(); });

// The first import transforms the whole snapshot module graph; on a slow machine that takes
// longer than one test may run. Later imports after vi.resetModules reuse the transform cache.
beforeAll(async () => { await import('./cliSnapshot'); }, 120_000);

// Native install classification knows darwin, linux and win32. Android (Termux) runs the same
// Linux binaries but reports `android`, so the native tests run as on Linux there.
function withLinuxPlatformOnAndroid(): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  if (process.platform === 'android') Object.defineProperty(process, 'platform', { ...original, value: 'linux' });
  return () => { Object.defineProperty(process, 'platform', original); };
}

async function withNativeCli(run: (context: {
  binary: string;
  detect: typeof import('./cliSnapshot')['detectCliSnapshotOnDaemonPath'];
  invalidate: typeof import('./cliSnapshot')['invalidateCliSnapshots'];
}) => Promise<void>, header = '\x7fELFtest-native-fixture') {
  vi.resetModules();
  processBoundary.calls = 0;
  processBoundary.version = '1.2.3';
  processBoundary.wait = Promise.resolve();
  processBoundary.beforeProbe = null;
  const fixture = await createProbeTempDir('happier-version-cache');
  const env = createEnvKeyScope(['HOME', 'USERPROFILE', 'PATH', 'HAPPIER_OPENCODE_PATH']);
  const restorePlatform = withLinuxPlatformOnAndroid();
  try {
    const bin = join(fixture.dir, '.opencode', 'bin');
    await mkdir(bin, { recursive: true });
    const binary = join(bin, process.platform === 'win32' ? 'opencode.exe' : 'opencode');
    await writeExecutableScript(binary, 'fixture');
    await writeFile(binary, Buffer.from(header, 'latin1'));
    env.patch({ HOME: fixture.dir, USERPROFILE: fixture.dir, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` });
    delete process.env.HAPPIER_OPENCODE_PATH;
    const { detectCliSnapshotOnDaemonPath: detect, invalidateCliSnapshots: invalidate } = await import('./cliSnapshot');
    await run({ binary, detect, invalidate });
  } finally { restorePlatform(); env.restore(); await fixture.cleanup(); }
}

async function withPackageCli(run: (context: {
  launcher: string;
  manifest: string;
  detect: typeof import('./cliSnapshot')['detectCliSnapshotOnDaemonPath'];
}) => Promise<void>, binEntry = 'bin/opencode') {
  vi.resetModules();
  processBoundary.calls = 0;
  processBoundary.version = '1.2.3';
  processBoundary.wait = Promise.resolve();
  processBoundary.beforeProbe = null;
  const fixture = await createProbeTempDir('happier-version-cache-package');
  const env = createEnvKeyScope(['HOME', 'USERPROFILE', 'PATH', 'HAPPIER_OPENCODE_PATH']);
  try {
    // A package manager install: the PATH entry is a symlink to the bin script of a package.
    const packageRoot = join(fixture.dir, 'lib', 'node_modules', 'opencode-fixture');
    const launcher = join(packageRoot, 'bin', 'opencode');
    await mkdir(dirname(launcher), { recursive: true });
    await writeExecutableScript(launcher, "#!/usr/bin/env node\nrequire('../lib/main.cjs');\n");
    const manifest = join(packageRoot, 'package.json');
    await writeFile(manifest, JSON.stringify({ name: 'opencode-fixture', version: '1.2.3', bin: { opencode: binEntry } }));
    const bin = join(fixture.dir, 'bin');
    await mkdir(bin, { recursive: true });
    await symlink(launcher, join(bin, 'opencode'));
    env.patch({ HOME: fixture.dir, USERPROFILE: fixture.dir, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` });
    delete process.env.HAPPIER_OPENCODE_PATH;
    const { detectCliSnapshotOnDaemonPath: detect } = await import('./cliSnapshot');
    await run({ launcher, manifest, detect });
  } finally { env.restore(); await fixture.cleanup(); }
}

const request = { requestedCliNames: ['opencode'] as const };

describe('CLI version reuse', () => {
  it.each(['\x7fELFtest-native-fixture', 'MZtest-native-fixture', '\xfe\xed\xfa\xcftest-native-fixture'])(
    'reuses native versions after snapshot expiry and refreshes changed binaries (%s)', async (header) => {
    await withNativeCli(async ({ binary, detect, invalidate }) => {
      expect((await detect(request)).clis.opencode.version).toBe('1.2.3');
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      expect((await detect(request)).clis.opencode.version).toBe('1.2.3');
      expect(processBoundary.calls).toBe(1);
      processBoundary.version = '2.0.0';
      const later = new Date(Date.now() + 60_000);
      await utimes(binary, later, later);
      vi.setSystemTime(Date.now() + 31_000);
      expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
      expect(processBoundary.calls).toBe(2);
      invalidate();
      await detect(request);
      expect(processBoundary.calls).toBe(3);
    }, header);
  });

  it('does not admit a version if an update retargets the executable during its probe', async () => {
    await withNativeCli(async ({ binary, detect }) => {
      const bin = dirname(binary);
      const targetA = join(dirname(bin), 'version-a');
      const targetB = join(dirname(bin), 'version-b');
      await rename(bin, targetA);
      await mkdir(targetB);
      await writeExecutableScript(join(targetB, basename(binary)), '\x7fELFnative-version-b');
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      await symlink(targetA, bin, linkType);
      processBoundary.beforeProbe = async () => {
        processBoundary.beforeProbe = null;
        await unlink(bin);
        await symlink(targetB, bin, linkType);
        processBoundary.version = '2.0.0';
      };
      expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
      await unlink(bin);
      await symlink(targetA, bin, linkType);
      processBoundary.version = '1.2.3';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      expect((await detect(request)).clis.opencode.version).toBe('1.2.3');
      expect(processBoundary.calls).toBe(2);
    });
  });

  it.each([{ killed: true }, { code: 1 }])('does not retain a version banner from an unsuccessful process (%j)', async (failure) => {
    await withNativeCli(async ({ detect }) => {
      processBoundary.beforeProbe = async () => {
        throw Object.assign(new Error('version command failed'), failure,
          { stdout: 'opencode 1.2.3\n', stderr: '' });
      };
      // Preserve the existing best-effort projection for this observation.
      expect((await detect(request)).clis.opencode.version).toBe('1.2.3');
      processBoundary.beforeProbe = null;
      processBoundary.version = '2.0.0';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
    });
  });

  it('explicit refresh and verification probe even an unchanged native executable', async () => {
    await withNativeCli(async ({ detect }) => {
      await detect(request);
      processBoundary.version = '2.0.0';
      expect((await detect({ ...request, bypassCache: true })).clis.opencode.version).toBe('2.0.0');
      processBoundary.version = '3.0.0';
      expect((await detect({ ...request, verifyVersion: true })).clis.opencode.version).toBe('3.0.0');
      expect(processBoundary.calls).toBe(3);
    });
  });

  it('shares ordinary concurrent probes across distinct snapshot keys', async () => {
    await withNativeCli(async ({ detect }) => {
      const snapshots = await Promise.all([detect(request), detect({ requestedCliNames: ['opencode', 'codex'] })]);
      expect(snapshots.map(s => s.clis.opencode.version)).toEqual(['1.2.3', '1.2.3']);
      expect(processBoundary.calls).toBe(1);
    });
  });

  it('retries ordinary discovery after a process never settles within the probe budget', async () => {
    await withNativeCli(async ({ detect }) => {
      const env = createEnvKeyScope(['HAPPIER_CLI_SNAPSHOT_PROBE_TIMEOUT_MS']);
      let release!: () => void;
      processBoundary.wait = new Promise<void>(resolve => { release = resolve; });
      env.patch({ HAPPIER_CLI_SNAPSHOT_PROBE_TIMEOUT_MS: '25' });
      try {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        const older = detect(request);
        await vi.waitFor(() => expect(processBoundary.calls).toBe(1));
        // The outer deadline can expire before identity lookup starts the shared budget.
        // Advance that budget only after the process has actually started.
        await vi.advanceTimersByTimeAsync(25);
        expect((await older).clis.opencode.version).toBeUndefined();
        processBoundary.wait = Promise.resolve();
        processBoundary.version = '2.0.0';
        vi.setSystemTime(Date.now() + 31_000);
        expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
        // A late successful completion must not become a reusable version fact.
        release();
        await vi.advanceTimersByTimeAsync(0);
        vi.setSystemTime(Date.now() + 31_000);
        expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
      } finally { release(); env.restore(); }
    });
  });

  it('fresh recovery supersedes an in-flight ordinary snapshot', async () => {
    await withNativeCli(async ({ detect }) => {
      let release!: () => void;
      processBoundary.wait = new Promise<void>(resolve => { release = resolve; });
      const older = detect(request);
      await vi.waitFor(() => expect(processBoundary.calls).toBe(1));
      processBoundary.wait = Promise.resolve();
      processBoundary.version = '2.0.0';
      try {
        expect((await detect({ ...request, bypassCache: true })).clis.opencode.version).toBe('2.0.0');
      } finally { release(); await older; }
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
    });
  });

  it('invalidation prevents pending observations from repopulating the cache', async () => {
    await withNativeCli(async ({ detect, invalidate }) => {
      let release!: () => void;
      processBoundary.wait = new Promise<void>(resolve => { release = resolve; });
      const older = detect(request);
      await vi.waitFor(() => expect(processBoundary.calls).toBe(1));
      invalidate();
      release();
      await older;
      processBoundary.wait = Promise.resolve();
      processBoundary.version = '2.0.0';
      expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
    });
  });

  it('retries an unsuccessful fresh probe instead of retaining the old version', async () => {
    await withNativeCli(async ({ detect }) => {
      await detect(request);
      processBoundary.version = '';
      expect((await detect({ ...request, bypassCache: true })).clis.opencode.version).toBeUndefined();
      processBoundary.version = '2.0.0';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
    });
  });

  it.each(['#!/bin/sh\nexec other-provider "$@"\n', '@echo off\r\nother-provider %*\r\n', "require('./provider.cjs');\n"])(
    'does not persist versions for opaque launchers, even in a native installation root (%s)', async (launcher) => {
      await withNativeCli(async ({ binary, detect }) => {
        await writeFile(binary, launcher);
        await detect(request);
        processBoundary.version = '2.0.0';
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 31_000);
        expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
      });
    },
  );

  it.runIf(process.platform !== 'win32')('reads the version of a package bin script from its manifest without a process', async () => {
    await withPackageCli(async ({ manifest, detect }) => {
      // The probe answers differently, so the result shows which source was read.
      processBoundary.version = '9.9.9';
      expect((await detect(request)).clis.opencode.version).toBe('1.2.3');
      expect(processBoundary.calls).toBe(0);
      // A package update rewrites the manifest.
      await writeFile(manifest, JSON.stringify({ name: 'opencode-fixture', version: '2.0.0', bin: { opencode: 'bin/opencode' } }));
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
      expect(processBoundary.calls).toBe(0);
      // Explicit refresh still asks the executable.
      expect((await detect({ ...request, bypassCache: true })).clis.opencode.version).toBe('9.9.9');
      expect(processBoundary.calls).toBe(1);
    });
  });

  it.runIf(process.platform !== 'win32')('does not persist versions for a script that is not the bin entry of its package', async () => {
    await withPackageCli(async ({ detect }) => {
      await detect(request);
      processBoundary.version = '2.0.0';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      expect((await detect(request)).clis.opencode.version).toBe('2.0.0');
    }, 'bin/other');
  });
});
