import { constants, copyFileSync, linkSync, statSync } from 'node:fs';
import { copyFile, link, stat } from 'node:fs/promises';

import { logger } from '@/ui/logger';

export type PublishedFileIdentity = Readonly<{ dev: number; ino: number }>;

/**
 * Errors from link() on a filesystem that has no hard links. Android app storage gives EACCES;
 * Linux gives EPERM for FAT-type filesystems.
 */
const HARD_LINK_UNAVAILABLE_CODES = new Set(['EACCES', 'EPERM']);

let reportedCopyFallback = false;

function isHardLinkUnavailable(error: unknown): boolean {
  return HARD_LINK_UNAVAILABLE_CODES.has(String((error as NodeJS.ErrnoException | null)?.code ?? ''));
}

function reportCopyFallback(error: unknown, destinationPath: string): void {
  if (reportedCopyFallback) return;
  reportedCopyFallback = true;
  logger.info('[fs] Hard links are unavailable; publishing files as exclusive copies', {
    code: (error as NodeJS.ErrnoException | null)?.code,
    destinationPath,
  });
}

/**
 * Publishes the finished file at sourcePath as destinationPath, only when destinationPath does not
 * exist (EEXIST otherwise). A hard link where the filesystem has them; elsewhere an exclusive copy
 * (COPYFILE_EXCL), which keeps the EEXIST rule. A reader can see a copy before its content is
 * complete, so readers must treat a short or unparseable file as held, not as free.
 *
 * Returns the identity of the published file: the source's for a link, the copy's own for a copy.
 * Callers that later prove "this is still the file I published" compare against this identity,
 * never against the source's.
 */
export async function publishFileExclusive(sourcePath: string, destinationPath: string): Promise<PublishedFileIdentity> {
  try {
    await link(sourcePath, destinationPath);
    const info = await stat(sourcePath);
    return { dev: info.dev, ino: info.ino };
  } catch (error) {
    if (!isHardLinkUnavailable(error)) throw error;
    reportCopyFallback(error, destinationPath);
  }
  await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  const info = await stat(destinationPath);
  return { dev: info.dev, ino: info.ino };
}

/** The synchronous form of publishFileExclusive, for callers that cannot await. */
export function publishFileExclusiveSync(sourcePath: string, destinationPath: string): PublishedFileIdentity {
  try {
    linkSync(sourcePath, destinationPath);
    const info = statSync(sourcePath);
    return { dev: info.dev, ino: info.ino };
  } catch (error) {
    if (!isHardLinkUnavailable(error)) throw error;
    reportCopyFallback(error, destinationPath);
  }
  copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  const info = statSync(destinationPath);
  return { dev: info.dev, ino: info.ino };
}
