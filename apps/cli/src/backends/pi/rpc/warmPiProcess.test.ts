import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HAPPIER_PI_PREWARM_ENV_KEY, prewarmPiProcess, releaseWarmPiProcess, takeWarmPiProcess } from './warmPiProcess';

// A minimal copy of Pi's bundle layout: cli.js next to cli-runtime.js, which imports its chunks
// and then runs. The runtime reports what a started Pi would see, then echoes its stdin.
function createFakePiBundle(root: string): string {
  const bundle = join(root, 'bundle');
  mkdirSync(join(bundle, 'chunks'), { recursive: true });
  writeFileSync(join(bundle, 'chunks', 'main.js'), 'globalThis.__chunkLoads = (globalThis.__chunkLoads ?? 0) + 1;\n');
  writeFileSync(join(bundle, 'cli.js'), '// entry\n');
  writeFileSync(join(bundle, 'cli-runtime.js'), [
    'import"./chunks/main.js";',
    'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), entry: process.argv[1], cwd: process.cwd(),',
    '  marker: process.env.WARM_PI_TEST_MARKER ?? null, chunkLoads: globalThis.__chunkLoads }) + "\\n");',
    'process.stdin.on("data", (chunk) => process.stdout.write("echo:" + chunk));',
    'process.stdin.on("end", () => process.exit(0));',
  ].join('\n'));
  return join(bundle, 'cli.js');
}

const dirs: string[] = [];
afterEach(() => {
  releaseWarmPiProcess();
  delete process.env[HAPPIER_PI_PREWARM_ENV_KEY];
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('warm Pi process', () => {
  it('runs a launch with its arguments, directory, environment and stdin, from preloaded chunks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'warm-pi-'));
    dirs.push(root);
    const cliPath = createFakePiBundle(root);
    const workDir = join(root, 'work');
    mkdirSync(workDir);
    process.env[HAPPIER_PI_PREWARM_ENV_KEY] = '1';

    prewarmPiProcess({ resolveLaunch: () => ({ command: cliPath, args: [] }) });
    const child = takeWarmPiProcess({
      command: cliPath,
      args: ['--mode', 'rpc'],
      cwd: workDir,
      env: { ...process.env, WARM_PI_TEST_MARKER: 'session' },
    });
    expect(child).not.toBeNull();

    let output = '';
    child!.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child!.stdin.write('{"type":"get_state"}\n');
    child!.stdin.end();
    await new Promise<void>((resolve) => child!.once('exit', () => resolve()));

    const [report, ...rest] = output.split('\n');
    expect(JSON.parse(report!)).toEqual({
      argv: ['--mode', 'rpc'],
      entry: realpathSync(cliPath),
      cwd: realpathSync(workDir),
      marker: 'session',
      chunkLoads: 1,
    });
    expect(rest.join('\n')).toContain('echo:{"type":"get_state"}');
  }, 20_000);

  it('leaves a launch of another program to a cold start', () => {
    const root = mkdtempSync(join(tmpdir(), 'warm-pi-'));
    dirs.push(root);
    const cliPath = createFakePiBundle(root);
    const otherCliPath = createFakePiBundle(join(root, 'other'));
    process.env[HAPPIER_PI_PREWARM_ENV_KEY] = '1';

    prewarmPiProcess({ resolveLaunch: () => ({ command: cliPath, args: [] }) });
    expect(takeWarmPiProcess({ command: otherCliPath, args: [], cwd: root, env: process.env })).toBeNull();
    const child = takeWarmPiProcess({ command: cliPath, args: [], cwd: root, env: process.env });
    expect(child).not.toBeNull();
    child?.stdin.end();
  });
});
