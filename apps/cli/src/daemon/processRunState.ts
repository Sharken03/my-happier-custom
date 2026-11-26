import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isPidAliveBySignal as probePidAliveBySignal } from '../../scripts/process_tree.cjs';

const execFileAsync = promisify(execFile);

/**
 * Coarse process run state for daemon liveness decisions.
 *
 * A session runner must be ABLE TO SERVE (consume its pending queue, answer RPC) for the daemon
 * to refuse a resume as "already running". `process.kill(pid, 0)` alone lies for two classes:
 * - `stopped`: SIGSTOPped/traced (`ps` state `T`/`t`) — alive, holds its lock, serves nothing.
 * - `zombie`: defunct (`ps` state `Z`) — signalable on some platforms, permanently dead.
 *
 * Incident class: daemon log 2026-06-12 "Resume requested ... but session is already running"
 * while the runner cannot serve; the user message is materialized into the pending queue and
 * never consumed.
 */
export type ProcessRunState = 'dead' | 'servable' | 'stopped' | 'zombie';

export function isPidAliveBySignal(pid: number): boolean {
  return probePidAliveBySignal(pid);
}

function signalProbeIsDenied(pid: number, signalPid: (pid: number) => void): boolean {
  try {
    signalPid(pid);
    return false;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    return code === 'EPERM';
  }
}

/**
 * Run state of a PID that a lock or tracked session records as this user's session runner.
 *
 * Session runners run under the daemon's own UID, so signal 0 to a live runner always succeeds.
 * On POSIX, EPERM means the PID belongs to another user: the runner is gone and the PID was
 * reused (Android gives freed PIDs to other app UIDs, whose /proc entries and `ps` rows are
 * hidden). Such a PID cannot be our runner, so it is reported `dead`. Other probe failures keep
 * the fail-closed `readProcessRunState` result.
 */
export async function readSessionRunnerProcessRunState(pid: number, deps?: Readonly<{
  signalPid?: (pid: number) => void;
  platform?: NodeJS.Platform;
  readRunState?: (pid: number) => Promise<ProcessRunState>;
}>): Promise<ProcessRunState> {
  const platform = deps?.platform ?? process.platform;
  const signalPid = deps?.signalPid ?? ((target: number) => { process.kill(target, 0); });
  if (platform !== 'win32' && Number.isFinite(pid) && pid > 0 && signalProbeIsDenied(pid, signalPid)) {
    return 'dead';
  }
  return await (deps?.readRunState ?? readProcessRunState)(pid);
}

function classifyPosixStateChar(stateOutput: string): ProcessRunState | null {
  const stateChar = stateOutput.trim().charAt(0);
  if (!stateChar) return null;
  if (stateChar === 'T' || stateChar === 't') return 'stopped';
  if (stateChar === 'Z') return 'zombie';
  return 'servable';
}

/**
 * Reads the run state of a process. Fail-closed: when the process is alive but its state cannot
 * be inspected (ps failure, unsupported platform), it is reported `servable` so callers keep the
 * existing duplicate-spawn protection. Windows has no SIGSTOP/zombie semantics → alive = servable.
 */
export async function readProcessRunState(pid: number, deps?: Readonly<{
  isPidAlive?: (pid: number) => boolean;
  platform?: NodeJS.Platform;
}>): Promise<ProcessRunState> {
  if (!Number.isFinite(pid) || pid <= 0) return 'dead';
  const isPidAlive = deps?.isPidAlive ?? isPidAliveBySignal;
  const platform = deps?.platform ?? process.platform;
  const alive = isPidAlive(pid);

  if (platform === 'win32') {
    return alive ? 'servable' : 'dead';
  }

  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(Math.floor(pid)), '-o', 'state='], {
      timeout: 5_000,
    });
    const classified = classifyPosixStateChar(stdout);
    if (classified) return classified;
  } catch {
    // ps exits non-zero when the pid does not exist; fall through to the signal probe.
  }
  // The runner may exit while ps is pending. Re-observe the signal boundary instead of
  // retaining the pre-probe snapshot; unobservable live PIDs still fail closed as servable.
  return isPidAlive(pid) ? 'servable' : 'dead';
}
