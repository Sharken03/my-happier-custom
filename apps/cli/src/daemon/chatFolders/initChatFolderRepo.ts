import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { runScmCommand } from '@/scm/runtime';

import { isChatFolder } from './chatFolderTitleLink';

/**
 * Makes a new chat folder a git repository, so the app's changed-files view (git based: Session and
 * Turn) can show what the chat changed there. Only a chat folder without `.git` qualifies. Returns
 * whether git initialized it.
 */
export async function initChatFolderRepo(params: Readonly<{
  sessionPath: string;
  chatsDir: string;
}>): Promise<boolean> {
  if (!isChatFolder(params.sessionPath, params.chatsDir)) return false;
  if (existsSync(join(params.sessionPath, '.git'))) return false;
  const result = await runScmCommand({ bin: 'git', cwd: params.sessionPath, args: ['init', '--quiet'], timeoutMs: 15_000 });
  return result.success;
}

/** A `.git` that `git init` made and nothing used: no branch has a commit and there are no packed refs. */
export async function isUnusedGitDir(gitDir: string): Promise<boolean> {
  if (existsSync(join(gitDir, 'packed-refs'))) return false;
  try {
    return (await readdir(join(gitDir, 'refs', 'heads'))).length === 0;
  } catch {
    return false;
  }
}
