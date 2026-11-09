import { describe, expect, it, vi } from 'vitest';

import { groupByRepository, pathInside, resolveRepositoryRoots } from './externalRepositoryChanges';

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
