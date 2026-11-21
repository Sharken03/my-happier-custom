import { readdir, rm, rmdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { isChatFolder, removeChatFolderTitleLinks } from './chatFolderTitleLink';
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

  await removeChatFolderTitleLinks({ chatsDir: params.chatsDir, folder: basename(params.sessionPath) });
  return true;
}
