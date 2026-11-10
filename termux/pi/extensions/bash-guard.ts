// Limits for the bash tool, so one command cannot load the phone for a long time.
// - Time: a command without a timeout gets 300 s; a longer timeout is cut to 1800 s.
//   Pi then stops the whole process tree.
// - Priority: each command runs at nice 10, so the Happier relay, the daemon and the chats
//   stay responsive while it runs.
// - grep and rg: the folder bin/ next to this extension's folder (~/.pi/agent/bin) comes first
//   in PATH. Its grep and rg stop the real tool after a CPU-time limit and tell the model why.
//   (On 10/11-2026 a grep with ".{0,2500}" on each side of a match ran for minutes on a 342 MB
//   binary.) A memory limit is not possible: "ulimit -v" stops Android's linker before a
//   program starts.
// The spawn hook adds the nice and PATH lines out of view, so the chat shows the model's command.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const DEFAULT_TIMEOUT_S = 300;
export const MAX_TIMEOUT_S = 1800;
export const NICE = 10;

const GUARD_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin");

/** The timeout in seconds that a bash call gets. */
export function guardTimeout(timeout: number | undefined): number {
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) return DEFAULT_TIMEOUT_S;
  return Math.min(timeout, MAX_TIMEOUT_S);
}

/** The command and env that the shell gets. */
export function guardSpawn(
  { command, cwd, env }: { command: string; cwd: string; env: NodeJS.ProcessEnv },
  guardBin = GUARD_BIN,
) {
  const pathValue = env.PATH ? `${guardBin}:${env.PATH}` : guardBin;
  return {
    command: `renice -n ${NICE} -p $$ >/dev/null 2>&1\n${command}`,
    cwd,
    env: { ...env, PATH: pathValue },
  };
}

export default function (pi: ExtensionAPI) {
  const bash = createBashToolDefinition(process.cwd(), { spawnHook: (context) => guardSpawn(context) });
  pi.registerTool({
    ...bash,
    description:
      `${bash.description} Without a timeout the command stops after ${DEFAULT_TIMEOUT_S} s; ` +
      `the maximum is ${MAX_TIMEOUT_S} s. grep and rg stop after a CPU-time limit.`,
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      bash.execute(toolCallId, { ...params, timeout: guardTimeout(params.timeout) }, signal, onUpdate, ctx),
  });
}
