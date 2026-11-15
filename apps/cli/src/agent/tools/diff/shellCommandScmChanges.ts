import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import type { FileChangeEvidence } from '@happier-dev/protocol';

import { buildPlaceholderUnifiedDiff } from './derivePendingNormalizedToolChange';

/** A file's change time may be up to this much before the first command of the turn. */
const MTIME_TOLERANCE_MS = 2_000;
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
/** More candidates than this in one repository means a bulk change; those are not listed. */
const MAX_FILES_PER_REPOSITORY = 200;

const SHELL_SEPARATORS = /[\s;|&()<>`"'=]+/;

export type ShellCommandPathMentions = Readonly<{
    paths: ReadonlySet<string>;
    baseNames: ReadonlySet<string>;
}>;

function looksLikePath(token: string): boolean {
    return token.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(token);
}

function expandToken(token: string, homeDir: string): string {
    if (token === '~') return homeDir;
    if (token.startsWith('~/')) return join(homeDir, token.slice(2));
    if (token.startsWith('$HOME/')) return join(homeDir, token.slice('$HOME/'.length));
    if (token.startsWith('${HOME}/')) return join(homeDir, token.slice('${HOME}/'.length));
    return token;
}

/**
 * The paths a shell command names, made absolute. A `cd <dir>` earlier in the command moves the
 * base for later relative paths. This is a heuristic: it reads tokens, not shell grammar.
 */
export function extractShellCommandPathMentions(params: Readonly<{
    command: string;
    cwd: string;
    homeDir: string;
}>): ShellCommandPathMentions {
    const paths = new Set<string>();
    const baseNames = new Set<string>();
    let base = params.cwd;
    const tokens = params.command.split(SHELL_SEPARATORS).filter((token) => token.length > 0);
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]!;
        if (token === 'cd' && index + 1 < tokens.length) {
            const target = expandToken(tokens[index + 1]!, params.homeDir);
            if (!target.startsWith('-') && !target.includes('$')) {
                base = isAbsolute(target) ? target : resolve(base, target);
                paths.add(base);
            }
            index += 1;
            continue;
        }
        if (token.startsWith('-') || token.includes('$') || token.includes('*') || !looksLikePath(token)) continue;
        const expanded = expandToken(token, params.homeDir);
        const absolute = isAbsolute(expanded) ? expanded : resolve(base, expanded);
        paths.add(absolute);
        const name = basename(absolute);
        if (name.includes('.')) baseNames.add(name);
    }
    return { paths, baseNames };
}

type GitRunner = (cwd: string, args: readonly string[]) => Promise<string | null>;

const runGit: GitRunner = (cwd, args) => new Promise((resolveOutput) => {
    execFile('git', ['-C', cwd, ...args], {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }, (error, stdout) => {
        resolveOutput(error ? null : stdout);
    });
});

async function nearestDirectory(path: string): Promise<string | null> {
    let current = path;
    for (let depth = 0; depth < 64; depth += 1) {
        try {
            if ((await stat(current)).isDirectory()) return current;
        } catch {
            // Not there (yet): try the parent.
        }
        const parent = dirname(current);
        if (parent === current) return null;
        current = parent;
    }
    return null;
}

function splitNul(output: string | null): string[] {
    return (output ?? '').split('\0').filter((part) => part.length > 0);
}

/** Paths from `git status --porcelain=v1 -z`; a rename record carries its source path next. */
function parseStatusPaths(output: string | null): Array<Readonly<{ path: string; untracked: boolean }>> {
    const parts = splitNul(output);
    const files: Array<Readonly<{ path: string; untracked: boolean }>> = [];
    for (let index = 0; index < parts.length; index += 1) {
        const record = parts[index]!;
        if (record.length < 4) continue;
        const code = record.slice(0, 2);
        files.push({ path: record.slice(3), untracked: code === '??' });
        if (code.includes('R') || code.includes('C')) index += 1;
    }
    return files;
}

/**
 * Finds the files a turn's shell commands changed, through git: a provider's edit tools report
 * their own files, but a `sed -i`, a redirect or a script does not.
 *
 * A file counts when all three hold:
 * 1. git shows it changed (working tree or a commit made since the turn's first command);
 * 2. it changed after the turn's first command;
 * 3. a command of the turn names it (by path or by file name).
 * The checks keep out the changes that other agents make at the same time in a shared checkout.
 */
export class ShellCommandScmChangeTracker {
    private readonly homeDir: string;
    private readonly git: GitRunner;
    private readonly now: () => number;
    private turnStartedAtMs: number | null = null;
    private readonly mentionedPaths = new Set<string>();
    private readonly mentionedBaseNames = new Set<string>();
    private readonly candidateDirectories = new Set<string>();

    constructor(params: Readonly<{ homeDir: string; git?: GitRunner; now?: () => number }>) {
        this.homeDir = params.homeDir;
        this.git = params.git ?? runGit;
        this.now = params.now ?? Date.now;
    }

    observeShellCommand(params: Readonly<{ command: string; cwd: string }>): void {
        if (!params.command.trim()) return;
        if (this.turnStartedAtMs === null) this.turnStartedAtMs = this.now();
        this.candidateDirectories.add(params.cwd);
        const mentions = extractShellCommandPathMentions({ command: params.command, cwd: params.cwd, homeDir: this.homeDir });
        for (const path of mentions.paths) {
            this.mentionedPaths.add(path);
            this.candidateDirectories.add(path);
        }
        for (const name of mentions.baseNames) this.mentionedBaseNames.add(name);
    }

    /** True when the current turn ran a shell command, so completeTurn has git work to do. */
    hasShellCommands(): boolean {
        return this.turnStartedAtMs !== null;
    }

    resetTurn(): void {
        this.turnStartedAtMs = null;
        this.mentionedPaths.clear();
        this.mentionedBaseNames.clear();
        this.candidateDirectories.clear();
    }

    /** The changed files of the turn, oldest repository first; resets the turn. */
    async completeTurn(): Promise<FileChangeEvidence[]> {
        const startedAtMs = this.turnStartedAtMs;
        const directories = [...this.candidateDirectories];
        const mentionedPaths = new Set(this.mentionedPaths);
        const mentionedBaseNames = new Set(this.mentionedBaseNames);
        this.resetTurn();
        if (startedAtMs === null) return [];

        const roots = new Set<string>();
        for (const directory of directories) {
            const existing = await nearestDirectory(directory);
            if (!existing) continue;
            const root = (await this.git(existing, ['rev-parse', '--show-toplevel']))?.trim();
            if (root) roots.add(root);
        }

        const files: FileChangeEvidence[] = [];
        for (const root of roots) {
            files.push(...await this.collectRepositoryChanges({ root, startedAtMs, mentionedPaths, mentionedBaseNames }));
        }
        return files;
    }

    private async collectRepositoryChanges(params: Readonly<{
        root: string;
        startedAtMs: number;
        mentionedPaths: ReadonlySet<string>;
        mentionedBaseNames: ReadonlySet<string>;
    }>): Promise<FileChangeEvidence[]> {
        const status = parseStatusPaths(await this.git(params.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
        const sinceSeconds = Math.floor((params.startedAtMs - MTIME_TOLERANCE_MS) / 1000);
        const committed = splitNul(await this.git(params.root, ['log', `--since=@${sinceSeconds}`, '--name-only', '--format=', '-z']))
            .map((path) => path.replace(/^\n+/, ''))
            .filter((path) => path.length > 0);

        const candidates = new Map<string, Readonly<{ untracked: boolean; committed: boolean }>>();
        for (const file of status) candidates.set(file.path, { untracked: file.untracked, committed: false });
        for (const path of committed) {
            if (!candidates.has(path)) candidates.set(path, { untracked: false, committed: true });
        }
        if (candidates.size === 0 || candidates.size > MAX_FILES_PER_REPOSITORY) return [];

        const files: FileChangeEvidence[] = [];
        for (const [relativePath, kind] of candidates) {
            const filePath = join(params.root, relativePath);
            if (!params.mentionedPaths.has(filePath) && !params.mentionedBaseNames.has(basename(filePath))) continue;
            let mtimeMs: number | null = null;
            try {
                mtimeMs = (await stat(filePath)).mtimeMs;
            } catch {
                // Deleted: git status lists it, and a command named it.
            }
            if (mtimeMs !== null && mtimeMs < params.startedAtMs - MTIME_TOLERANCE_MS) continue;
            files.push({
                filePath,
                changeKind: mtimeMs === null ? 'deleted' : kind.untracked ? 'added' : 'modified',
                unifiedDiff: await this.readDiff({ root: params.root, relativePath, filePath, kind }),
                source: 'scm_reconciled',
                confidence: 'best_effort',
                provider: 'scm',
                description: 'Changed by a shell command',
            });
        }
        return files;
    }

    private async readDiff(params: Readonly<{
        root: string;
        relativePath: string;
        filePath: string;
        kind: Readonly<{ untracked: boolean; committed: boolean }>;
    }>): Promise<string> {
        const placeholder = buildPlaceholderUnifiedDiff(params.filePath, 'Changed by a shell command');
        if (params.kind.untracked) return placeholder;
        const args = params.kind.committed
            ? ['log', '-1', '--format=', '-p', '--', params.relativePath]
            : ['diff', 'HEAD', '--', params.relativePath];
        const diff = await this.git(params.root, args);
        return diff && diff.trim().length > 0 ? diff.replace(/^\n+/, '') : placeholder;
    }
}
