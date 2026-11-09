/**
 * Files a chat changed outside its own repository (the session change set's unmatched files),
 * grouped by the git repository that holds each one, as Happy's per-chat changes did. The app
 * asks the machine for each folder's repository root through the session's SCM status call
 * with an absolute `cwd`, which the machine's file access policy allows for the OS user.
 */

export type ExternalChangedFile<TChange> = Readonly<{
    /** Absolute path, as the agent's tool call named it. */
    filePath: string;
    /** Path inside its repository, or the absolute path when no repository holds it. */
    displayPath: string;
    change: TChange;
}>;

export type ExternalRepositoryGroup<TChange> = Readonly<{
    /** Repository root, or null for files that no repository holds. */
    rootPath: string | null;
    files: readonly ExternalChangedFile<TChange>[];
}>;

export function isAbsoluteFilePath(path: string): boolean {
    return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

function trimTrailingSeparators(path: string): string {
    return path.length > 1 ? path.replace(/[\\/]+$/, '') : path;
}

export function parentDirectory(path: string): string {
    const trimmed = trimTrailingSeparators(path);
    const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    if (cut < 0) return trimmed;
    return cut === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, cut);
}

/** The path below root, or null when path is not inside root (sibling prefixes do not count). */
export function pathInside(path: string, root: string): string | null {
    const base = trimTrailingSeparators(root);
    if (path === base) return '';
    for (const separator of ['/', '\\']) {
        if (path.startsWith(base + separator)) return path.slice(base.length + 1);
    }
    return null;
}

/**
 * Finds the repository root for each folder that holds a changed file, asking once per folder that
 * no root found so far already covers. `resolveRoot` answers null for a folder outside git.
 */
export async function resolveRepositoryRoots(
    filePaths: readonly string[],
    resolveRoot: (folder: string) => Promise<string | null>,
): Promise<ReadonlyMap<string, string | null>> {
    const roots = new Map<string, string | null>();
    const knownRoots: string[] = [];
    for (const filePath of filePaths) {
        const folder = parentDirectory(filePath);
        if (roots.has(folder)) continue;
        const covering = knownRoots.find((root) => pathInside(folder, root) !== null);
        if (covering) {
            roots.set(folder, covering);
            continue;
        }
        const root = await resolveRoot(folder);
        roots.set(folder, root);
        if (root && !knownRoots.includes(root)) knownRoots.push(root);
    }
    return roots;
}

/** Groups the files by repository, in the order each repository first appears; files outside git last. */
export function groupByRepository<TChange>(
    files: ReadonlyArray<Readonly<{ filePath: string; change: TChange }>>,
    rootsByFolder: ReadonlyMap<string, string | null>,
): ExternalRepositoryGroup<TChange>[] {
    const groups = new Map<string, ExternalChangedFile<TChange>[]>();
    const outside: ExternalChangedFile<TChange>[] = [];
    for (const file of files) {
        const root = rootsByFolder.get(parentDirectory(file.filePath)) ?? null;
        const inside = root ? pathInside(file.filePath, root) : null;
        if (!root || inside === null) {
            outside.push({ filePath: file.filePath, displayPath: file.filePath, change: file.change });
            continue;
        }
        const list = groups.get(root) ?? [];
        list.push({ filePath: file.filePath, displayPath: inside, change: file.change });
        groups.set(root, list);
    }
    const result: ExternalRepositoryGroup<TChange>[] = [...groups].map(([rootPath, groupFiles]) => ({ rootPath, files: groupFiles }));
    if (outside.length > 0) result.push({ rootPath: null, files: outside });
    return result;
}
