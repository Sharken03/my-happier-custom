import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import type { AccountSettings } from '@happier-dev/protocol';
import { INSTALLABLE_KEYS } from '@happier-dev/protocol';

import { resolveExistingAgyAcpManagedBinPath } from '@/capabilities/deps/agyAcp';
import { ensureRuntimeInstallablesForLaunch } from '@/installables/runtime/ensureRuntimeInstallablesForLaunch';
import { readSettings } from '@/persistence';
import { getActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveAgyAcpReleaseAsset } from '@/runtime/managedTools/providers/agyAcpRelease';

export async function ensureAgyAcpServerForLaunch(params: Readonly<{
  accountSettings?: AccountSettings | null;
  env?: NodeJS.ProcessEnv;
  readinessOnly?: boolean;
}> = {}): Promise<Readonly<{ command: string; args: readonly string[] }>> {
  const override = resolveAgyAcpCommandOverride({ ...process.env, ...params.env });
  if (override) return override;
  const machineId = (await readSettings()).machineId ?? '';
  const ensured = await ensureRuntimeInstallablesForLaunch({
    installableKeys: [INSTALLABLE_KEYS.AGY_ACP_SERVER],
    settings: params.accountSettings ?? getActiveAccountSettingsSnapshot()?.settings ?? null,
    machineId,
    env: params.env,
    ...(params.readinessOnly ? { readinessOnly: true } : {}),
  });
  if (!ensured.ok) {
    const detail = ensured.logPath ? `${ensured.errorMessage} (install log: ${ensured.logPath})` : ensured.errorMessage;
    throw new Error(`Agy ACP server is unavailable: ${detail}`);
  }

  const command = resolveExistingAgyAcpManagedBinPath();
  if (!command) {
    throw new Error('Agy ACP server install completed but no runnable managed executable was found');
  }
  return { command, args: resolveAgyAcpReleaseAsset().args };
}

/**
 * An ACP server to start in place of the managed agy-acp-server: an absolute path in
 * HAPPIER_AGY_ACP_COMMAND, with HAPPIER_AGY_ACP_ARGS as a JSON array of arguments. Used where the
 * pinned server cannot run, such as Android, whose 39-bit address space the server's allocator
 * does not support; there a bridge drives the agy CLI instead.
 */
function resolveAgyAcpCommandOverride(env: NodeJS.ProcessEnv): Readonly<{ command: string; args: readonly string[] }> | null {
  const command = env.HAPPIER_AGY_ACP_COMMAND?.trim();
  if (!command) return null;
  if (!isAbsolute(command) || !existsSync(command) || !statSync(command).isFile()) {
    throw new Error(`HAPPIER_AGY_ACP_COMMAND must be an absolute path to a file: ${command}`);
  }
  const rawArgs = env.HAPPIER_AGY_ACP_ARGS?.trim();
  let args: unknown = [];
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      args = null;
    }
  }
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    throw new Error('HAPPIER_AGY_ACP_ARGS must be a JSON array of strings');
  }
  return { command, args };
}
