import { describe, expect, it } from 'vitest';

import { resolveToolCallSheetLabel } from './toolCallSheetLabel';

function tool(name: string, input: unknown, description: string | null = null, state: 'running' | 'completed' = 'completed') {
    return { name, input, description, state } as const;
}

describe('resolveToolCallSheetLabel', () => {
    it('prefers the description of a command', () => {
        expect(resolveToolCallSheetLabel(tool('Bash', { command: 'ls -la', description: 'List files' }))).toMatchObject({
            kind: 'commands', running: false, target: 'List files',
        });
    });

    it('falls back to the first line of the command', () => {
        expect(resolveToolCallSheetLabel(tool('bash', { command: '\ncd /x && ls\nmore' })).target).toBe('cd /x && ls');
    });

    it('uses the path for reads and edits, and the first URL for web fetches', () => {
        expect(resolveToolCallSheetLabel(tool('Read', { file_path: '/a/b.ts' }))).toMatchObject({ kind: 'reads', target: '/a/b.ts' });
        expect(resolveToolCallSheetLabel(tool('edit', { path: '/a/c.ts' }))).toMatchObject({ kind: 'edits', target: '/a/c.ts' });
        expect(resolveToolCallSheetLabel(tool('fetch_content', { urls: ['https://x.dev'] })).target).toBe('https://x.dev');
    });

    it('marks a running call and keeps the tool name for other tools', () => {
        expect(resolveToolCallSheetLabel(tool('ListAgents', {}, null, 'running'))).toEqual({
            kind: 'other', running: true, target: null, toolName: 'ListAgents',
        });
    });
});
