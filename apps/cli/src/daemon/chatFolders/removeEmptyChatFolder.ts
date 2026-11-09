import { lstat, readdir, readlink, rm, rmdir, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { isChatFolder } from './chatFolderTitleLink';
import { isUnusedGitDir } from './initChatFolderRepo';

/**
 * Removes a stopped chat's own folder when the chat left nothing in it, with its title links. The
 * `.git` that initChatFolderRepo made counts as nothing until a branch has a commit.
 * Only a folder that the app named for a chat (`<chatsDir>/<date>-<id>`) qualifies; the daemon
 * creates such a folder again without asking when the chat resumes (startDaemon, chat folders are
 * daemon-owned). Returns whether the folder went.
 */
export async function removeEmptyChatFolder(params: Readonly<{
  sessionPath: string;
  chatsDir: string;
}>): Promise<boolean> {
  if (!isChatFolder(params.sessionPath, params.chatsDir)) return false;
  let entries: string[];
  try {
    entries = await readdir(params.sessionPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (entries.length === 1 && entries[0] === '.git' && await isUnusedGitDir(join(params.sessionPath, '.git'))) {
    await rm(join(params.sessionPath, '.git'), { recursive: true });
  } else if (entries.length > 0) {
    return false;
  }
  await rmdir(params.sessionPath);

  const folder = basename(params.sessionPath);
  for (const entry of await readdir(params.chatsDir)) {
    const path = join(params.chatsDir, entry);
    const info = await lstat(path).catch(() => null);
    if (info?.isSymbolicLink() && await readlink(path) === folder) await unlink(path);
  }
  return true;
}
