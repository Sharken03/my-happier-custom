import { describe, expect, it, vi } from 'vitest';

import type { Message } from '@/sync/domains/messages/messageTypes';

import {
    deriveToolCallChangedPaths,
    groupByRepository,
    mergeExternalChangedFiles,
    pathInside,
    resolveAgentChangeView,
    resolveRepositoryRoots,
    workingTreeChangedPaths,
} from './externalRepositoryChanges';

function toolCall(name: string, input: unknown, opts: { state?: 'running' | 'completed' | 'error'; children?: Message[] } = {}): Message {
    return {
        kind: 'tool-call',
        id: `${name}-${JSON.stringify(input)}`,
        localId: null,
        createdAt: 1,
        tool: { name, state: opts.state ?? 'completed', input, createdAt: 1, startedAt: 1, completedAt: 2, description: null },
        children: opts.children ?? [],
    } as Message;
}

describe('external repository changes', () => {
    it('asks once per folder that no found repository covers', async () => {
        const resolveRoot = vi.fn(async (folder: string) => (folder.startsWith('/home/u/happier') ? '/home/u/happier' : null));
        const roots = await resolveRepositoryRoots([
            '/home/u/happier/apps/cli/a.ts',
            '/home/u/happier/apps/cli/b.ts',
            '/home/u/happier/apps/ui/c.ts',
            '/home/u/notes/todo.md',
        ], resolveRoot);

        expect(resolveRoot.mock.calls.map(([folder]) => folder)).toEqual(['/home/u/happier/apps/cli', '/home/u/notes']);
        expect(roots.get('/home/u/happier/apps/ui')).toBe('/home/u/happier');
        expect(roots.get('/home/u/notes')).toBeNull();
    });

    it('groups files by repository with paths inside it, and files outside git last', () => {
        const roots = new Map<string, string | null>([
            ['/home/u/happier/apps/cli', '/home/u/happier'],
            ['/home/u/notes', null],
        ]);
        const groups = groupByRepository([
            { filePath: '/home/u/notes/todo.md', change: 1 },
            { filePath: '/home/u/happier/apps/cli/a.ts', change: 2 },
        ], roots);

        expect(groups).toEqual([
            { rootPath: '/home/u/happier', files: [{ filePath: '/home/u/happier/apps/cli/a.ts', displayPath: 'apps/cli/a.ts', change: 2 }] },
            { rootPath: null, files: [{ filePath: '/home/u/notes/todo.md', displayPath: '/home/u/notes/todo.md', change: 1 }] },
        ]);
    });

    it('does not treat a sibling folder with the same prefix as inside', () => {
        expect(pathInside('/home/u/happier2/x.ts', '/home/u/happier')).toBeNull();
        expect(pathInside('C:\\repo\\src\\x.ts', 'C:\\repo')).toBe('src\\x.ts');
    });
});

describe('resolveAgentChangeView', () => {
    const placeholder = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -0,0 +0,0 @@', '# Write'].join('\n');

    it('shows a diff that changes lines', () => {
        const diff = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b';
        expect(resolveAgentChangeView({ unifiedDiff: diff })).toEqual({ kind: 'unified', unifiedDiff: diff });
    });

    it('skips a placeholder diff for the old and new text', () => {
        expect(resolveAgentChangeView({ unifiedDiff: placeholder, oldText: 'a', newText: 'b' })).toEqual({ kind: 'text', oldText: 'a', newText: 'b' });
    });

    it('gives a note when there is nothing to show', () => {
        expect(resolveAgentChangeView({ unifiedDiff: placeholder })).toEqual({ kind: 'none' });
        expect(resolveAgentChangeView({ oldText: 'same', newText: 'same' })).toEqual({ kind: 'none' });
    });
});

describe('workingTreeChangedPaths', () => {
    it('lists changed paths and both sides of a rename', () => {
        const paths = workingTreeChangedPaths([{ path: 'a.ts' }, { path: 'new.ts', previousPath: 'old.ts' }]);
        expect([...paths].sort()).toEqual(['a.ts', 'new.ts', 'old.ts']);
    });

});

describe('changed paths from tool calls', () => {
    it('collects absolute paths of file-changing tool calls, also in child calls, once each', () => {
        const messages: Message[] = [
            toolCall('Edit', { file_path: '/r/a.ts' }),
            toolCall('Write', { file_path: '/r/a.ts' }),
            toolCall('Read', { file_path: '/r/read-only.ts' }),
            toolCall('Edit', { file_path: 'relative.ts' }),
            toolCall('Edit', { file_path: '/r/failed.ts' }, { state: 'error' }),
            toolCall('Task', { prompt: 'x' }, { children: [toolCall('Write', { file_path: '/other/b.md' })] }),
            { kind: 'agent-text', id: 't', localId: null, createdAt: 1, text: 'done' } as Message,
        ];

        expect(deriveToolCallChangedPaths(messages)).toEqual(['/r/a.ts', '/other/b.md']);
    });

    it('adds extra paths outside the own repository to the change set files, without duplicates', () => {
        const fromChangeSet = { filePath: '/other/a.ts', unifiedDiff: '@@' };
        const merged = mergeExternalChangedFiles({
            changeSetFiles: [fromChangeSet],
            extraPaths: ['/other/a.ts', '/other/b.ts', '/own/src/c.ts', '/own', 'relative.ts'],
            ownRootPath: '/own',
        });

        expect(merged).toEqual([
            { filePath: '/other/a.ts', change: fromChangeSet },
            { filePath: '/other/b.ts', change: null },
        ]);
    });

    it('keeps every absolute extra path when the own repository is not known', () => {
        expect(mergeExternalChangedFiles({ changeSetFiles: [], extraPaths: ['/x/a'], ownRootPath: null }))
            .toEqual([{ filePath: '/x/a', change: null }]);
    });
});
