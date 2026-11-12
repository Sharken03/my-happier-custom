import { spawn, type ChildProcess } from 'node:child_process';

import { logger } from '@/ui/logger';

import { HAPPIER_DAEMON_PENDING_FIRST_INPUT_ENV_KEY } from './pendingFirstInput';
import { HAPPIER_RUNNER_PREWARM_ENV_KEY, type PrewarmedRunnerAssignment } from './prewarmedRunnerAssignment';

/**
 * Session facts a runner reads from its environment when it uses them, not when its modules
 * load. Only these may differ between a prewarmed process and the launch it takes over: every
 * other value must be equal, because a loaded module may already hold it.
 */
const SESSION_LAZY_ENV_KEYS: ReadonlySet<string> = new Set([
  HAPPIER_RUNNER_PREWARM_ENV_KEY,
  HAPPIER_DAEMON_PENDING_FIRST_INPUT_ENV_KEY,
  'HAPPIER_SESSION_ATTACH_FILE',
]);

type RunnerProgram = Readonly<{
  filePath: string;
  /** The program's own arguments (runtime flags and entry), before the runner's arguments. */
  baseArgs: readonly string[];
}>;
type RememberedLaunch = RunnerProgram & Readonly<{ env: Readonly<Record<string, string>>; cwd: string }>;
type RunnerLaunch = RunnerProgram & Readonly<{
  userArgs: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}>;
type PrewarmSpawnOptions = {
  cwd: string;
  env: Record<string, string>;
  detached: true;
  stdio: ['pipe', 'ignore', 'ignore'];
  windowsHide: true;
};

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function withoutLazyKeys(env: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!SESSION_LAZY_ENV_KEYS.has(key)) out[key] = value;
  }
  return out;
}

function sameRecord(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameArgs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((arg, index) => arg === b[index]);
}

/**
 * One runner process that has loaded the CLI and waits for its launch.
 *
 * Loading the CLI takes seconds on a phone. When the app shows that a spawn is likely, the
 * daemon starts the process a spawn would start, from the last ordinary launch; the next spawn
 * that fits takes it over. A process no spawn takes ends itself when its stdin closes: at the
 * time limit, or when the daemon exits.
 */
export function createPrewarmedRunnerSlot(deps: Readonly<{
  spawnChild?: (filePath: string, args: readonly string[], options: PrewarmSpawnOptions) => ChildProcess;
  ttlMs?: number;
  isEnabled?: () => boolean;
  logDebug?: (message: string, context: Readonly<Record<string, unknown>>) => void;
}> = {}) {
  const logDebug = deps.logDebug ?? ((message, context) => logger.debug(message, context));
  const spawnChild = deps.spawnChild ?? ((filePath, args, options) => spawn(filePath, [...args], options));
  const ttlMs = deps.ttlMs ?? 120_000;
  const isEnabled = deps.isEnabled ?? (() => process.env.HAPPIER_DAEMON_RUNNER_PREWARM === '1');

  type WarmEntry = { child: ChildProcess; launch: RememberedLaunch; timer: ReturnType<typeof setTimeout> };
  let remembered: RememberedLaunch | null = null;
  let warm: WarmEntry | null = null;

  const release = () => {
    if (!warm) return;
    clearTimeout(warm.timer);
    warm.child.stdin?.end();
    warm = null;
  };

  return {
    isEnabled,

    /** Records an ordinary runner launch as the model for the next prewarmed process. */
    rememberLaunch(launch: RunnerProgram & Readonly<{ env: NodeJS.ProcessEnv; cwd: string }>): void {
      remembered = {
        filePath: launch.filePath,
        baseArgs: [...launch.baseArgs],
        env: withoutLazyKeys(definedEnv(launch.env)),
        cwd: launch.cwd,
      };
    },

    /** Starts the prewarmed process, unless one waits already. */
    prewarm(): void {
      if (!isEnabled() || !remembered || warm) return;
      const launch = remembered;
      const child = spawnChild(launch.filePath, launch.baseArgs, {
        cwd: launch.cwd,
        env: { ...launch.env, [HAPPIER_RUNNER_PREWARM_ENV_KEY]: '1' },
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
      });
      if (!child.pid || !child.stdin) return;
      child.stdin.on('error', () => {});
      const entry: WarmEntry = {
        child,
        launch,
        timer: setTimeout(() => {
          if (warm === entry) release();
        }, ttlMs),
      };
      entry.timer.unref?.();
      child.once('exit', () => {
        if (warm === entry) {
          clearTimeout(entry.timer);
          warm = null;
        }
      });
      child.once('error', () => {
        if (warm === entry) release();
      });
      warm = entry;
    },

    /**
     * Hands the launch to the prewarmed process and returns it as the runner, or returns null
     * when none waits or the launch does not fit; the caller then spawns a cold runner.
     */
    take(launch: RunnerLaunch): ChildProcess | null {
      if (!warm) return null;
      const { child, launch: warmLaunch } = warm;
      if (child.exitCode !== null || !child.stdin || child.stdin.writableEnded) return null;
      if (launch.filePath !== warmLaunch.filePath || !sameArgs(launch.baseArgs, warmLaunch.baseArgs)) return null;
      // The configuration reads a runtime-context prefix when the modules load.
      if (launch.userArgs.includes('--runtime-context')) return null;
      const env = definedEnv(launch.env);
      const comparable = withoutLazyKeys(env);
      if (!sameRecord(comparable, warmLaunch.env)) {
        // Names only: a value can be private.
        const differingKeys = [...new Set([...Object.keys(comparable), ...Object.keys(warmLaunch.env)])]
          .filter((key) => comparable[key] !== warmLaunch.env[key]);
        logDebug('[DAEMON RUN] The prewarmed runner does not fit this launch', { differingKeys });
        return null;
      }

      const assignment: PrewarmedRunnerAssignment = { args: [...launch.userArgs], env, cwd: launch.cwd };
      clearTimeout(warm.timer);
      warm = null;
      child.stdin.end(`${JSON.stringify(assignment)}\n`);
      return child;
    },

    /** Lets a waiting process end (daemon shutdown). */
    dispose(): void {
      release();
    },
  };
}

/** The daemon's one slot. Session runners never remember a launch, so theirs stays empty. */
export const prewarmedRunnerSlot = createPrewarmedRunnerSlot();
