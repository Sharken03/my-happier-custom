import { lstat, readdir, readlink, symlink, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/** The name the app gives a new chat's folder: `<YYYY-MM-DD>-<4 base-36 characters>`. */
const CHAT_FOLDER_NAME = /^\d{4}-\d{2}-\d{2}-[0-9a-z]{4}$/;
const MAX_SLUG_LENGTH = 60;

/** A readable folder name for a chat title: letters and digits of any script, joined by dashes. */
export function chatTitleSlug(title: string): string {
  return title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
}

/** Whether `sessionPath` is a chat's own folder directly inside `chatsDir`. */
export function isChatFolder(sessionPath: string, chatsDir: string): boolean {
  return resolve(dirname(sessionPath)) === resolve(chatsDir) && CHAT_FOLDER_NAME.test(basename(sessionPath));
}

async function linkTarget(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink() ? await readlink(path) : '';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Points `<chatsDir>/<title slug>` at a chat's own folder, so the folder can be found by the chat's
 * title. The folder itself is never renamed: agents key their transcripts by the session path.
 * The link is relative (the folder name), a taken name gets `-2`, `-3`, ..., and the chat's earlier
 * title link goes. Returns the link's name, or null when the session is not in a chat folder or
 * the title has no letters or digits.
 */
export async function linkChatFolderTitle(params: Readonly<{
  sessionPath: string;
  chatsDir: string;
  title: string;
}>): Promise<string | null> {
  if (!isChatFolder(params.sessionPath, params.chatsDir)) return null;
  const folder = basename(params.sessionPath);
  const slug = chatTitleSlug(params.title);
  if (!slug || CHAT_FOLDER_NAME.test(slug)) return null;

  let name: string | null = null;
  for (let n = 1; n < 100 && name === null; n += 1) {
    const candidate = n === 1 ? slug : `${slug}-${n}`;
    const target = await linkTarget(join(params.chatsDir, candidate));
    if (target === folder) return candidate;
    if (target === null) name = candidate;
  }
  if (name === null) return null;
  await symlink(folder, join(params.chatsDir, name), 'dir');

  for (const entry of await readdir(params.chatsDir)) {
    if (entry === name) continue;
    if (await linkTarget(join(params.chatsDir, entry)) === folder) {
      await unlink(join(params.chatsDir, entry));
    }
  }
  return name;
}
