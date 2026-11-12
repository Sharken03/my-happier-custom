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
 * `false` when stdin closes with no valid launch (the daemon let the process go).
 */
export async function awaitPrewarmedRunnerAssignment(proc: AssignableProcess): Promise<boolean> {
  let buffered = '';
  for await (const chunk of proc.stdin) {
    buffered += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
    if (buffered.includes('\n')) break;
  }
  const assignment = parseAssignment(buffered.split('\n', 1)[0] ?? '');
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
