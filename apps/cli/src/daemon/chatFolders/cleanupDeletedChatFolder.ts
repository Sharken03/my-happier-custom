import { lstat, readdir, rm } from 'node:fs/promises';
import { basename } from 'node:path';

import { isChatFolder, removeChatFolderTitleLinks } from './chatFolderTitleLink';

/**
 * The entries the daemon itself gives a chat's folder: the repository `initChatFolderRepo` makes,
 * the uploads folder, and the ignore rule for those uploads. A folder that holds nothing else
 * carries nothing of the chat's own work.
 */
const DAEMON_OWNED_ENTRIES: ReadonlySet<string> = new Set(['.git', '.happier', '.gitignore']);

/**
 * Removes a deleted chat's own folder, with its title links, when the daemon is all that left
 * something in it (a repository, uploads, the ignore rule). Anything else in the folder — a file
 * the chat wrote, a directory it made — means the chat left work behind: the folder and every
 * entry in it stay untouched, repository included, so the work can still be found and committed.
 * Only a folder the app named for a chat (`<chatsDir>/<date>-<id>`) qualifies, and a symlink at
 * that path is never followed. Returns whether the folder went.
 */
export async function cleanupDeletedChatFolder(params: Readonly<{
  sessionPath: string;
  chatsDir: string;
}>): Promise<boolean> {
  if (!isChatFolder(params.sessionPath, params.chatsDir)) return false;

  const info = await lstat(params.sessionPath).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) return false;

  let entries: string[];
  try {
    entries = await readdir(params.sessionPath);
  } catch {
    return false;
  }
  if (entries.some((entry) => !DAEMON_OWNED_ENTRIES.has(entry))) return false;

  await rm(params.sessionPath, { recursive: true, force: true });
  await removeChatFolderTitleLinks({ chatsDir: params.chatsDir, folder: basename(params.sessionPath) });
  return true;
}
