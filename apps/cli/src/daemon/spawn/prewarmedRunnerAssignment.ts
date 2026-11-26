import type { Readable } from 'node:stream';

/** Set on a prewarmed runner process: it loads the CLI, then waits for its launch on stdin. */
export const HAPPIER_RUNNER_PREWARM_ENV_KEY = 'HAPPIER_RUNNER_PREWARM';

/** The launch a prewarmed runner gets: what a cold runner gets from its spawn call. */
export type PrewarmedRunnerAssignment = Readonly<{
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd: string;
}>;

type AssignableProcess = {
  stdin: Readable;
  env: NodeJS.ProcessEnv;
  argv: string[];
  chdir: (directory: string) => void;
};

function parseAssignment(line: string): PrewarmedRunnerAssignment | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { args, env, cwd } = parsed as { args?: unknown; env?: unknown; cwd?: unknown };
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) return null;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
  if (!Object.values(env).every((value) => typeof value === 'string')) return null;
  if (typeof cwd !== 'string' || !cwd) return null;
  return { args, env: env as Record<string, string>, cwd };
}

/**
 * Waits for the daemon's launch (one JSON line on stdin) and makes this process the runner a
 * cold spawn would have been: same arguments, environment and working directory. Resolves
 * `false` when stdin closes with no valid launch (the daemon let the process go). An empty
 * line is no launch: the daemon keeps the process, so its time limit starts again.
 */
export async function awaitPrewarmedRunnerAssignment(
  proc: AssignableProcess,
  opts: Readonly<{ maxWaitMs?: number }> = {},
): Promise<boolean> {
  // The daemon lets an unused process go by closing its input. The time limit ends the process
  // also when the daemon cannot (it hangs); 0 or no value means no limit.
  const maxWaitMs = opts.maxWaitMs ?? 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire: () => void = () => {};
  const expired = new Promise<null>((resolve) => { expire = () => resolve(null); });
  const startTimeLimit = () => {
    if (maxWaitMs <= 0) return;
    clearTimeout(timer);
    timer = setTimeout(expire, maxWaitMs);
  };
  const readLaunchLine = async (): Promise<string> => {
    let buffered = '';
    for await (const chunk of proc.stdin) {
      buffered += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
      let index = buffered.indexOf('\n');
      while (index >= 0) {
        const line = buffered.slice(0, index);
        buffered = buffered.slice(index + 1);
        if (line.trim()) return line;
        startTimeLimit();
        index = buffered.indexOf('\n');
      }
    }
    return buffered;
  };
  startTimeLimit();
  const line = maxWaitMs > 0
    ? await Promise.race([readLaunchLine(), expired]).finally(() => clearTimeout(timer))
    : await readLaunchLine();
  if (line === null) return false;
  const assignment = parseAssignment(line);
  if (!assignment) return false;

  for (const key of Object.keys(proc.env)) {
    if (!(key in assignment.env)) delete proc.env[key];
  }
  for (const [key, value] of Object.entries(assignment.env)) {
    proc.env[key] = value;
  }
  proc.chdir(assignment.cwd);
  proc.argv.splice(2, proc.argv.length, ...assignment.args);
  return true;
}
