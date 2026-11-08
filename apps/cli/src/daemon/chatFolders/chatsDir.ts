import { isAbsolute } from 'node:path';

import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

/**
 * The folder where new chats on this machine get their own folder, from HAPPIER_CHATS_DIR
 * (`~` expands). The daemon publishes it in the machine metadata (`chatsDir`), and the app then
 * starts a new chat in `<chatsDir>/<date>-<id>`. Null when unset or not absolute after expansion.
 */
export function resolveChatsDir(env: NodeJS.ProcessEnv): string | null {
  const raw = typeof env.HAPPIER_CHATS_DIR === 'string' ? env.HAPPIER_CHATS_DIR.trim() : '';
  if (!raw) return null;
  const expanded = expandHomeDirPath(raw, env).replace(/[\\/]+$/, '');
  return expanded && isAbsolute(expanded) ? expanded : null;
}
