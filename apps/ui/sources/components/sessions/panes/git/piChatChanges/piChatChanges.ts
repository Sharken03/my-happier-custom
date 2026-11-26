import { PiChatChangesListResponseSchema, type PiChatChangesFile } from '@happier-dev/protocol';

import type { ScmFileStatus, ScmStatusFiles } from '@/scm/scmStatusFiles';

/**
 * Files a Pi chat changed outside any git repository ("Outside the repository" in Changed files),
 * and the paths it changed in other git repositories ("Other repositories").
 * The Pi session lists them through `pi.chatChanges.list`; other sessions have no such files.
 */

export const NO_PI_CHAT_CHANGES: readonly PiChatChangesFile[] = Object.freeze([]);

export const NO_PI_REPO_PATHS: readonly string[] = Object.freeze([]);

/** A list response: the files outside git, and the paths the chat changed in other git repos. */
export type PiChatChangesList = Readonly<{
    files: readonly PiChatChangesFile[];
    repoPaths: readonly string[];
}>;

export const NO_PI_CHAT_CHANGES_LIST: PiChatChangesList = Object.freeze({ files: NO_PI_CHAT_CHANGES, repoPaths: NO_PI_REPO_PATHS });

/** The parts of a list response, or null when the call failed or the response is not valid. */
export function readPiChatChangesList(response: unknown): PiChatChangesList | null {
    const parsed = PiChatChangesListResponseSchema.safeParse(response);
    if (!parsed.success || !parsed.data.ok) return null;
    const repoPaths = (parsed.data.repoFiles ?? []).map((file) => file.path);
    return {
        files: parsed.data.files.length > 0 ? parsed.data.files : NO_PI_CHAT_CHANGES,
        repoPaths: repoPaths.length > 0 ? repoPaths : NO_PI_REPO_PATHS,
    };
}

/** The files of a list response, or null when the call failed or the response is not valid. */
export function readPiChatChangesFiles(response: unknown): readonly PiChatChangesFile[] | null {
    return readPiChatChangesList(response)?.files ?? null;
}

/** A row for the existing SCM change row: created files show as added, gone files as deleted. */
export function toPiChatChangeRow(file: PiChatChangesFile): ScmFileStatus {
    const cut = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\'));
    return {
        fileName: file.path.slice(cut + 1) || file.path,
        filePath: file.path,
        fullPath: file.path,
        status: file.deleted ? 'deleted' : file.created ? 'added' : 'modified',
        isIncluded: false,
        linesAdded: file.added,
        linesRemoved: file.removed,
    };
}

/** Adds the files to the header numbers next to the branch: created files as added, the rest as modified.
 * Deleted files are excluded: they cannot be staged and do not belong in pending. */
export function addPiChatChangeCounts(
    statusFiles: ScmStatusFiles | null,
    files: readonly PiChatChangesFile[],
): ScmStatusFiles | null {
    if (!statusFiles || files.length === 0) return statusFiles;
    const created = files.filter((file) => file.created).length;
    const deleted = files.filter((file) => file.deleted).length;
    const modified = files.length - created - deleted;
    return {
        ...statusFiles,
        totalIncluded: statusFiles.totalIncluded + created,
        totalPending: statusFiles.totalPending + modified,
    };
}

export function samePiChatChangesFiles(a: readonly PiChatChangesFile[], b: readonly PiChatChangesFile[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((file, index) => {
        const other = b[index];
        return file.path === other.path
            && file.created === other.created
            && file.tooLarge === other.tooLarge
            && file.deleted === other.deleted
            && file.added === other.added
            && file.removed === other.removed
            && file.updatedAt === other.updatedAt;
    });
}

export function samePiChatChangesList(a: PiChatChangesList, b: PiChatChangesList): boolean {
    return samePiChatChangesFiles(a.files, b.files)
        && a.repoPaths.length === b.repoPaths.length
        && a.repoPaths.every((path, index) => path === b.repoPaths[index]);
}
