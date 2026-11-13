import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { configuration } from '@/configuration';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import { logger } from '@/ui/logger';

/** Turns the prewarmed Pi process on. Read by a prewarmed session runner. */
export const HAPPIER_PI_PREWARM_ENV_KEY = 'HAPPIER_PI_PREWARM';

/** Environment values the Pi backend always sets; the prewarmed process loads with them. */
const PI_FIXED_ENV: Readonly<Record<string, string>> = { NODE_ENV: 'production', DEBUG: '', CI: '1' };

/**
 * Loads the modules of Pi's CLI, waits for one JSON line on stdin ({ entry, args, cwd, env }),
 * and then runs the CLI as a cold `pi` start with those values would. The rest of stdin stays
 * for Pi. When stdin ends before the line, the process exits.
 */
const LOADER_SOURCE = `import { enableCompileCache } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
try { enableCompileCache(); } catch {}
const runtimePath = process.argv[2];
try {
  const text = readFileSync(runtimePath, "utf8");
  for (const match of text.matchAll(/(?:from|import)\\s*"(\\.\\/chunks\\/[^"]+)"/g)) {
    await import(pathToFileURL(join(dirname(runtimePath), match[1])).href);
  }
} catch {}
function readFirstLine(stream) {
  return new Promise((resolve) => {
    let buffered = Buffer.alloc(0);
    const finish = (line) => { stream.off("readable", onReadable); stream.off("end", onEnd); resolve(line); };
    const onEnd = () => finish(null);
    const onReadable = () => {
      let chunk;
      while ((chunk = stream.read()) !== null) {
        buffered = Buffer.concat([buffered, chunk]);
        const index = buffered.indexOf(10);
        if (index >= 0) {
          const rest = buffered.subarray(index + 1);
          if (rest.length > 0) stream.unshift(rest);
          return finish(buffered.subarray(0, index).toString("utf8"));
        }
      }
    };
    stream.on("readable", onReadable);
    stream.once("end", onEnd);
  });
}
const line = await readFirstLine(process.stdin);
if (!line) process.exit(0);
const launch = JSON.parse(line);
for (const key of Object.keys(process.env)) if (!(key in launch.env)) delete process.env[key];
Object.assign(process.env, launch.env);
process.chdir(launch.cwd);
process.argv.splice(1, process.argv.length - 1, launch.entry, ...launch.args);
await import(pathToFileURL(runtimePath).href);
`;

type PiProgram = Readonly<{
  /** Pi's `cli.js`, the path a cold start runs. */
  entryPath: string;
  /** The module `cli.js` loads: it imports the chunks and starts the CLI. */
  runtimePath: string;
  /** The arguments after the entry. */
  args: readonly string[];
}>;

/**
 * Pi's program for a launch: the command itself (an executable `pi`) or the runtime's first
 * argument. Null for any other layout than the bundled `cli.js` next to `cli-runtime.js`.
 */
function resolvePiProgram(command: string, args: readonly string[]): PiProgram | null {
  const candidates: Array<Readonly<{ path: string; rest: readonly string[] }>> = [
    { path: command, rest: args },
    ...(args.length > 0 ? [{ path: args[0]!, rest: args.slice(1) }] : []),
  ];
  for (const candidate of candidates) {
    try {
      const entryPath = realpathSync(candidate.path);
      if (basename(entryPath) !== 'cli.js') continue;
      const runtimePath = join(dirname(entryPath), 'cli-runtime.js');
      if (!existsSync(runtimePath)) continue;
      return { entryPath, runtimePath, args: candidate.rest };
    } catch {
      // not a file: try the next candidate
    }
  }
  return null;
}

function materializeLoader(): string {
  const directory = join(configuration.happyHomeDir, 'tmp');
  const path = join(directory, 'pi-warm-loader-v1.mjs');
  try {
    if (readFileSync(path, 'utf8') === LOADER_SOURCE) return path;
  } catch {
    // missing: write it below
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, LOADER_SOURCE, { mode: 0o600 });
  return path;
}

type WarmPi = { child: ChildProcessWithoutNullStreams; runtimePath: string };
let warm: WarmPi | null = null;

function release(): void {
  const entry = warm;
  warm = null;
  entry?.child.stdin.end();
}

/**
 * Starts one Pi process that loads Pi's modules and waits for its launch, when
 * HAPPIER_PI_PREWARM=1. Loading takes about 1 s of a new Pi chat's start on a phone. The
 * process ends when its stdin closes: at `releaseWarmPiProcess` or when this process exits.
 */
export function prewarmPiProcess(deps: Readonly<{
  resolveLaunch?: () => Readonly<{ command: string; args: readonly string[] }>;
}> = {}): void {
  if (process.env[HAPPIER_PI_PREWARM_ENV_KEY] !== '1' || warm) return;
  try {
    const launch = deps.resolveLaunch?.() ?? requireProviderCliLaunchSpec('pi', { processEnv: process.env });
    const program = resolvePiProgram(launch.command, launch.args);
    if (!program) return;
    const child = spawn(process.execPath, [materializeLoader(), program.runtimePath], {
      cwd: homedir(),
      env: { ...process.env, ...PI_FIXED_ENV },
      stdio: 'pipe',
      windowsHide: true,
    });
    if (!child.pid) return;
    child.stdin.on('error', () => {});
    const entry: WarmPi = { child, runtimePath: program.runtimePath };
    child.once('exit', () => {
      if (warm === entry) warm = null;
    });
    child.once('error', () => {
      if (warm === entry) warm = null;
    });
    warm = entry;
  } catch (error) {
    logger.debug('[pi] Prewarm of a Pi process failed (non-fatal)', error);
  }
}

/** Lets an unused prewarmed Pi process end. */
export function releaseWarmPiProcess(): void {
  release();
}

/**
 * Hands a launch to the prewarmed Pi process and returns it, or returns null when none waits
 * or the launch runs another program; the caller then spawns Pi cold.
 */
export function takeWarmPiProcess(launch: Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}>): ChildProcessWithoutNullStreams | null {
  const entry = warm;
  if (!entry) return null;
  const { child } = entry;
  if (child.exitCode !== null || child.stdin.writableEnded) {
    warm = null;
    return null;
  }
  const program = resolvePiProgram(launch.command, launch.args);
  if (!program || program.runtimePath !== entry.runtimePath) return null;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(launch.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  warm = null;
  child.stdin.write(`${JSON.stringify({ entry: program.entryPath, args: program.args, cwd: launch.cwd, env })}\n`);
  logger.debug(`[pi] Using the prewarmed Pi process ${child.pid}`);
  return child;
}
