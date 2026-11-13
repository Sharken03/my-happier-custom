import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONSUMED_SESSION_ENV_KEYS } from '@/agent/runtime/createSessionMetadata';
import { configuration } from '@/configuration';
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
  // Read and deleted from the environment when the runner resolves its directory.
  'HAPPIER_SESSION_REQUESTED_DIRECTORY',
  'HAPPIER_SESSION_MACHINE_WORKSPACE_PATH',
  ...CONSUMED_SESSION_ENV_KEYS,
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

/**
 * The remembered launch as a difference from the daemon's own environment, so a restarted
 * daemon can prewarm before its first launch. Values the daemon already has are not stored.
 * A stale entry only fails `take`'s comparison: that launch starts cold and is remembered anew.
 */
type StoredLaunch = Readonly<{
  v: 1;
  filePath: string;
  baseArgs: string[];
  cwd: string;
  set: Record<string, string>;
  unset: string[];
}>;

function toStoredLaunch(launch: RememberedLaunch, baseEnv: Readonly<Record<string, string>>): StoredLaunch {
  const set: Record<string, string> = {};
  for (const [key, value] of Object.entries(launch.env)) {
    if (baseEnv[key] !== value) set[key] = value;
  }
  const unset = Object.keys(baseEnv).filter((key) => !(key in launch.env) && !SESSION_LAZY_ENV_KEYS.has(key));
  return { v: 1, filePath: launch.filePath, baseArgs: [...launch.baseArgs], cwd: launch.cwd, set, unset };
}

function fromStoredLaunch(text: string, baseEnv: Readonly<Record<string, string>>): RememberedLaunch | null {
  const stored = JSON.parse(text) as Partial<StoredLaunch>;
  if (stored.v !== 1 || typeof stored.filePath !== 'string' || typeof stored.cwd !== 'string') return null;
  if (!Array.isArray(stored.baseArgs) || !stored.baseArgs.every((arg) => typeof arg === 'string')) return null;
  if (!stored.set || typeof stored.set !== 'object' || !Array.isArray(stored.unset)) return null;
  if (!existsSync(stored.filePath)) return null;
  const env: Record<string, string> = { ...baseEnv };
  for (const key of stored.unset) delete env[key];
  for (const [key, value] of Object.entries(stored.set)) {
    if (typeof value === 'string') env[key] = value;
  }
  return { filePath: stored.filePath, baseArgs: stored.baseArgs, env: withoutLazyKeys(env), cwd: stored.cwd };
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
  /** Where the remembered launch is kept across daemon restarts; none when omitted. */
  statePath?: string;
  /** The daemon's own environment, which the stored launch is a difference from. */
  baseEnv?: NodeJS.ProcessEnv;
}> = {}) {
  const logDebug = deps.logDebug ?? ((message, context) => logger.debug(message, context));
  const spawnChild = deps.spawnChild ?? ((filePath, args, options) => spawn(filePath, [...args], options));
  const ttlMs = deps.ttlMs ?? 120_000;
  const isEnabled = deps.isEnabled ?? (() => process.env.HAPPIER_DAEMON_RUNNER_PREWARM === '1');

  type WarmEntry = { child: ChildProcess; launch: RememberedLaunch; timer: ReturnType<typeof setTimeout> };
  let remembered: RememberedLaunch | null = null;
  let warm: WarmEntry | null = null;
  let storedText: string | null = null;
  let storeRead = false;
  const baseEnv = () => definedEnv(deps.baseEnv ?? process.env);

  const readStoredLaunch = (): void => {
    if (storeRead || !deps.statePath) return;
    storeRead = true;
    try {
      storedText = readFileSync(deps.statePath, 'utf8');
      remembered ??= fromStoredLaunch(storedText, baseEnv());
    } catch {
      // no stored launch: the first launch is cold and is remembered
    }
  };

  const storeLaunch = (launch: RememberedLaunch): void => {
    if (!deps.statePath) return;
    const text = JSON.stringify(toStoredLaunch(launch, baseEnv()));
    if (text === storedText) return;
    try {
      writeFileSync(deps.statePath, text, { mode: 0o600 });
      storedText = text;
    } catch (error) {
      logDebug('[DAEMON RUN] Could not store the remembered launch', { error: String(error) });
    }
  };

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
      storeRead = true;
      remembered = {
        filePath: launch.filePath,
        baseArgs: [...launch.baseArgs],
        env: withoutLazyKeys(definedEnv(launch.env)),
        cwd: launch.cwd,
      };
      storeLaunch(remembered);
    },

    /** Starts the prewarmed process, unless one waits already. */
    prewarm(): void {
      if (isEnabled()) readStoredLaunch();
      if (!isEnabled() || !remembered || warm) {
        logDebug('[DAEMON RUN] Prewarm skipped', { enabled: isEnabled(), remembered: Boolean(remembered), waiting: Boolean(warm) });
        return;
      }
      const launch = remembered;
      const child = spawnChild(launch.filePath, launch.baseArgs, {
        cwd: launch.cwd,
        env: { ...launch.env, [HAPPIER_RUNNER_PREWARM_ENV_KEY]: '1' },
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
      });
      if (!child.pid || !child.stdin) return;
      logDebug('[DAEMON RUN] Prewarmed runner started', { pid: child.pid });
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
      if (!warm) {
        logDebug('[DAEMON RUN] No prewarmed runner waits for this launch', {});
        return null;
      }
      const { child, launch: warmLaunch } = warm;
      if (child.exitCode !== null || !child.stdin || child.stdin.writableEnded) {
        logDebug('[DAEMON RUN] The prewarmed runner has ended', { exitCode: child.exitCode });
        return null;
      }
      if (launch.filePath !== warmLaunch.filePath || !sameArgs(launch.baseArgs, warmLaunch.baseArgs)) {
        logDebug('[DAEMON RUN] The prewarmed runner has another program', {});
        return null;
      }
      // The configuration reads a runtime-context prefix when the modules load.
      if (launch.userArgs.includes('--runtime-context')) {
        logDebug('[DAEMON RUN] The launch has a runtime context', {});
        return null;
      }
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
export const prewarmedRunnerSlot = createPrewarmedRunnerSlot({
  statePath: join(configuration.happyHomeDir, 'daemon-prewarm-launch.json'),
});
