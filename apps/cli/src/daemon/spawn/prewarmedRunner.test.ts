import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPrewarmedRunnerSlot } from './prewarmedRunner';
import {
  HAPPIER_RUNNER_PREWARM_ENV_KEY,
  awaitPrewarmedRunnerAssignment,
} from './prewarmedRunnerAssignment';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough; exitCode: number | null; pid: number; written: () => string;
  };
  const chunks: Buffer[] = [];
  child.stdin = new PassThrough();
  child.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.exitCode = null;
  child.pid = 4242;
  child.written = () => Buffer.concat(chunks).toString('utf8');
  return child;
}

const BASE = { filePath: '/bin/node', baseArgs: ['--no-warnings', '/cli/index.mjs'], cwd: '/home' };
const ENV = { PATH: '/bin', HAPPIER_HOME_DIR: '/h' };

describe('prewarmed runner slot', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(enabled = true) {
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawnChild = vi.fn((_file: string, _args: readonly string[], _options: unknown) => {
      const child = fakeChild();
      children.push(child);
      return child as never;
    });
    const logDebug = vi.fn();
    const slot = createPrewarmedRunnerSlot({ spawnChild, ttlMs: 60_000, isEnabled: () => enabled, logDebug });
    return { slot, spawnChild, children, logDebug };
  }

  it('starts no process before an ordinary launch was remembered, or when disabled', () => {
    const off = setup(false);
    off.slot.rememberLaunch({ ...BASE, env: ENV });
    off.slot.prewarm();
    expect(off.spawnChild).not.toHaveBeenCalled();

    const on = setup();
    on.slot.prewarm();
    expect(on.spawnChild).not.toHaveBeenCalled();
  });

  it('prewarms one process from the remembered launch and hands it the next launch', () => {
    const { slot, spawnChild, children } = setup();
    slot.rememberLaunch({ ...BASE, env: { ...ENV, HAPPIER_SESSION_ATTACH_FILE: '/old.json' } });
    slot.prewarm();
    slot.prewarm();

    expect(spawnChild).toHaveBeenCalledTimes(1);
    const [file, args, options] = spawnChild.mock.calls[0]! as [string, string[], { env: Record<string, string>; cwd: string }];
    expect(file).toBe('/bin/node');
    expect(args).toEqual(BASE.baseArgs);
    expect(options.cwd).toBe('/home');
    expect(options.env).toEqual({ ...ENV, [HAPPIER_RUNNER_PREWARM_ENV_KEY]: '1' });

    const taken = slot.take({
      filePath: '/bin/node',
      baseArgs: BASE.baseArgs,
      userArgs: ['pi', '--started-by', 'daemon'],
      env: { ...ENV, HAPPIER_SESSION_ATTACH_FILE: '/new.json' },
      cwd: '/work',
    });

    expect(taken).toBe(children[0]);
    expect(JSON.parse(children[0]!.written())).toEqual({
      args: ['pi', '--started-by', 'daemon'],
      env: { ...ENV, HAPPIER_SESSION_ATTACH_FILE: '/new.json' },
      cwd: '/work',
    });
    expect(children[0]!.stdin.writableEnded).toBe(true);
    // The slot is empty again: the process is a session runner now.
    expect(slot.take({ filePath: '/bin/node', baseArgs: BASE.baseArgs, userArgs: [], env: ENV, cwd: '/w' })).toBeNull();
  });

  it('refuses a launch whose program, flags or other environment differ', () => {
    const { slot, children, logDebug } = setup();
    slot.rememberLaunch({ ...BASE, env: ENV });
    slot.prewarm();
    const launch = { filePath: '/bin/node', baseArgs: BASE.baseArgs, userArgs: ['pi'], env: ENV, cwd: '/work' };

    expect(slot.take({ ...launch, env: { ...ENV, PROFILE_VALUE: 'x' } })).toBeNull();
    // The refusal names the keys, never their values.
    expect(logDebug).toHaveBeenCalledWith(expect.any(String), { differingKeys: ['PROFILE_VALUE'] });
    expect(slot.take({ ...launch, env: { PATH: '/bin' } })).toBeNull();
    expect(slot.take({ ...launch, baseArgs: ['/cli/other.mjs'] })).toBeNull();
    expect(slot.take({ ...launch, filePath: '/bin/other' })).toBeNull();
    expect(slot.take({ ...launch, userArgs: ['--runtime-context', 'abc', 'pi'] })).toBeNull();
    expect(children[0]!.written()).toBe('');
    // The refused process is still there for a launch that fits.
    expect(slot.take(launch)).toBe(children[0]);
  });

  it('lets an unused process end after the time limit and after it exits', () => {
    const { slot, spawnChild, children } = setup();
    slot.rememberLaunch({ ...BASE, env: ENV });
    slot.prewarm();
    vi.advanceTimersByTime(60_000);
    expect(children[0]!.stdin.writableEnded).toBe(true);
    expect(children[0]!.written()).toBe('');
    expect(slot.take({ filePath: '/bin/node', baseArgs: BASE.baseArgs, userArgs: ['pi'], env: ENV, cwd: '/w' })).toBeNull();

    slot.prewarm();
    expect(spawnChild).toHaveBeenCalledTimes(2);
    children[1]!.exitCode = 1;
    children[1]!.emit('exit', 1, null);
    expect(slot.take({ filePath: '/bin/node', baseArgs: BASE.baseArgs, userArgs: ['pi'], env: ENV, cwd: '/w' })).toBeNull();
  });
});

describe('prewarmed runner assignment', () => {
  function fakeProcess() {
    return {
      stdin: new PassThrough(),
      env: { PATH: '/bin', STALE: '1', [HAPPIER_RUNNER_PREWARM_ENV_KEY]: '1' } as NodeJS.ProcessEnv,
      argv: ['/bin/node', '/cli/index.mjs'],
      chdir: vi.fn(),
    };
  }

  it('applies the launch it gets: arguments, environment and directory', async () => {
    const proc = fakeProcess();
    const pending = awaitPrewarmedRunnerAssignment(proc);
    proc.stdin.end(`${JSON.stringify({ args: ['pi', '--started-by', 'daemon'], env: { PATH: '/bin', NEW: '2' }, cwd: '/work' })}\n`);

    await expect(pending).resolves.toBe(true);
    expect(proc.argv).toEqual(['/bin/node', '/cli/index.mjs', 'pi', '--started-by', 'daemon']);
    expect(proc.env).toEqual({ PATH: '/bin', NEW: '2' });
    expect(proc.chdir).toHaveBeenCalledWith('/work');
  });

  it('reports no launch when its input closes empty or holds no valid launch', async () => {
    const closed = fakeProcess();
    const pendingClosed = awaitPrewarmedRunnerAssignment(closed);
    closed.stdin.end();
    await expect(pendingClosed).resolves.toBe(false);

    const invalid = fakeProcess();
    const pendingInvalid = awaitPrewarmedRunnerAssignment(invalid);
    invalid.stdin.end('{"args":"pi"}\n');
    await expect(pendingInvalid).resolves.toBe(false);
    expect(invalid.chdir).not.toHaveBeenCalled();
  });
});
