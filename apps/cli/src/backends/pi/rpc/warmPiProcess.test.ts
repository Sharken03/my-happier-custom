import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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

// Pi's extension import step, reduced to the two places the warm loader changes (Pi 1.5.0
// chunk text). The runtime loads its extension from the launch directory and reports where and
// how often the module was imported and run.
function createFakePiBundleWithExtension(root: string): string {
  const bundle = join(root, 'bundle');
  mkdirSync(join(bundle, 'chunks'), { recursive: true });
  writeFileSync(join(bundle, 'chunks', 'pi.js'), [
    'var extensionCacheCwd,extensionCacheGeneration=0,extensionCache=new Map;',
    'function clearExtensionCache(){extensionCache.clear(),extensionCacheCwd=void 0,extensionCacheGeneration++}',
    'const pathsEqual=(a,b)=>a===b;',
    'function useExtensionCacheCwd(cwd){let resolvedCwd=cwd;return extensionCacheCwd!==void 0&&!pathsEqual(extensionCacheCwd,resolvedCwd)&&clearExtensionCache(),extensionCacheCwd=resolvedCwd,{cwd:resolvedCwd,generation:extensionCacheGeneration}}',
    'async function loadExtensionModule(path,cacheToken){',
    '  if(cacheToken&&cacheToken.cwd===extensionCacheCwd&&cacheToken.generation===extensionCacheGeneration&&extensionCache.has(path))return extensionCache.get(path);',
    '  globalThis.__imports=[...(globalThis.__imports??[]),process.env.WARM_PI_TEST_MARKER??null];',
    '  const factory=()=>{globalThis.__runs=(globalThis.__runs??0)+1};',
    '  if(cacheToken)extensionCache.set(path,factory);',
    '  return factory}',
    'async function loadExtension(resolvedPath,cacheToken){let factory=await loadExtensionModule(resolvedPath,cacheToken);factory();return{extension:{},error:null}}',
    'export class DefaultResourceLoader{constructor(options){this.cwd=options.cwd}async reload(){await loadExtension("/agent/ext.ts",useExtensionCacheCwd(this.cwd))}}',
    'export function getAgentDir(){return "/agent"}',
  ].join('\n'));
  writeFileSync(join(bundle, 'index.js'), 'export { DefaultResourceLoader, getAgentDir } from "./chunks/pi.js";\n');
  writeFileSync(join(bundle, 'cli.js'), '// entry\n');
  writeFileSync(join(bundle, 'cli-runtime.js'), [
    'import{DefaultResourceLoader}from"./chunks/pi.js";',
    'await new DefaultResourceLoader({ cwd: process.cwd() }).reload();',
    'process.stdout.write(JSON.stringify({ imports: globalThis.__imports, runs: globalThis.__runs }) + "\\n");',
    'process.stdin.on("data", () => {});',
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

  it('imports the extension modules while it waits and runs them once in the launch directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'warm-pi-'));
    dirs.push(root);
    const cliPath = createFakePiBundleWithExtension(root);
    const workDir = join(root, 'work');
    mkdirSync(workDir);
    process.env[HAPPIER_PI_PREWARM_ENV_KEY] = '1';

    prewarmPiProcess({ resolveLaunch: () => ({ command: cliPath, args: [] }) });
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const child = takeWarmPiProcess({
      command: cliPath,
      args: ['--mode', 'rpc'],
      cwd: workDir,
      env: { ...process.env, WARM_PI_TEST_MARKER: 'session' },
    });
    expect(child).not.toBeNull();

    let output = '';
    child!.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    await vi.waitFor(() => expect(output).toContain('\n'), { timeout: 10_000 });
    child!.stdin.end();

    // One import, before the launch (without the launch's marker); the module ran only in Pi.
    expect(JSON.parse(output.split('\n')[0]!)).toEqual({ imports: [null], runs: 1 });
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
