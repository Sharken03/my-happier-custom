import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractShellCommandPathMentions, ShellCommandScmChangeTracker } from './shellCommandScmChanges';

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo(root: string, files: Record<string, string>): void {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@example.invalid');
    git(root, 'config', 'user.name', 'test');
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
}

describe('extractShellCommandPathMentions', () => {
    it('resolves absolute, home and cd-relative paths and keeps base names', () => {
        const mentions = extractShellCommandPathMentions({
            command: "cd ~/repo && sed -i 's/a/b/' src/app.ts; cat /etc/hosts",
            cwd: '/work',
            homeDir: '/home/u',
        });
        // Quoted text counts too (a script may name the file it writes); extra paths are harmless.
        expect([...mentions.paths]).toEqual(expect.arrayContaining(['/etc/hosts', '/home/u/repo', '/home/u/repo/src/app.ts']));
        expect(mentions.paths.has('/work/src/app.ts')).toBe(false);
        expect(mentions.baseNames.has('app.ts')).toBe(true);
    });
});

describe('ShellCommandScmChangeTracker', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'shell-scm-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('reports a file a shell command changed in another repository', async () => {
        const repo = join(dir, 'repo');
        execFileSync('mkdir', [repo]);
        makeRepo(repo, { 'a.txt': 'one\n', 'b.txt': 'two\n' });
        const tracker = new ShellCommandScmChangeTracker({ homeDir: dir });

        tracker.observeShellCommand({ command: `sed -i 's/one/uno/' ${repo}/a.txt`, cwd: join(dir) });
        writeFileSync(join(repo, 'a.txt'), 'uno\n');

        const files = await tracker.completeTurn();
        expect(files.map((file) => file.filePath)).toEqual([join(repo, 'a.txt')]);
        expect(files[0]!.source).toBe('scm_reconciled');
        expect(files[0]!.unifiedDiff).toContain('+uno');
    });

    it('reports a file committed during the turn', async () => {
        const repo = join(dir, 'repo');
        execFileSync('mkdir', [repo]);
        makeRepo(repo, { 'a.txt': 'one\n' });
        const tracker = new ShellCommandScmChangeTracker({ homeDir: dir });

        tracker.observeShellCommand({ command: `cd ${repo} && sed -i s/one/uno/ a.txt && git commit -qam x`, cwd: dir });
        writeFileSync(join(repo, 'a.txt'), 'uno\n');
        git(repo, 'commit', '-qam', 'x');

        const files = await tracker.completeTurn();
        expect(files.map((file) => file.filePath)).toEqual([join(repo, 'a.txt')]);
    });

    it('skips a changed file that no command named and a file changed before the turn', async () => {
        const repo = join(dir, 'repo');
        execFileSync('mkdir', [repo]);
        makeRepo(repo, { 'a.txt': 'one\n', 'b.txt': 'two\n', 'old.txt': 'x\n' });
        writeFileSync(join(repo, 'old.txt'), 'dirty before\n');
        const past = new Date(Date.now() - 60_000);
        utimesSync(join(repo, 'old.txt'), past, past);
        const tracker = new ShellCommandScmChangeTracker({ homeDir: dir });

        tracker.observeShellCommand({ command: `cat ${repo}/old.txt; sed -i s/one/uno/ ${repo}/a.txt`, cwd: dir });
        writeFileSync(join(repo, 'a.txt'), 'uno\n');
        writeFileSync(join(repo, 'b.txt'), 'changed by someone else\n');

        const files = await tracker.completeTurn();
        expect(files.map((file) => file.filePath)).toEqual([join(repo, 'a.txt')]);
    });

    it('reports nothing for a turn without shell commands', async () => {
        const tracker = new ShellCommandScmChangeTracker({ homeDir: dir });
        expect(await tracker.completeTurn()).toEqual([]);
    });
});
