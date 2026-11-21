import { describe, expect, it } from 'vitest';

import { makeToolCall } from '@/dev/testkit';

import { installToolShellCommonModuleMocks } from '@/components/tools/shell/views/ToolView.testHelpers';

installToolShellCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
});

describe('resolveToolPermissionTerminalErrorMessage (answered questions)', () => {
    it('does not show a canceled banner on a question that carries the user answers', async () => {
        const { resolveToolPermissionTerminalErrorMessage } = await import(
            '@/components/tools/shell/permissions/resolveToolPermissionTerminalErrorMessage'
        );

        const tool = makeToolCall({
            name: 'AskUserQuestion',
            state: 'error',
            result: { answers: { 'Platform: Hvor læser du tabellen?': 'Begge steder' } },
            permission: { id: 'q1', status: 'canceled', kind: 'user_action', decision: 'abort' },
        } as Parameters<typeof makeToolCall>[0]);

        expect(resolveToolPermissionTerminalErrorMessage({ tool, metadata: null })).toBeNull();
    });

    it('still reports a canceled question that has no answers', async () => {
        const { resolveToolPermissionTerminalErrorMessage } = await import(
            '@/components/tools/shell/permissions/resolveToolPermissionTerminalErrorMessage'
        );

        const tool = makeToolCall({
            name: 'AskUserQuestion',
            state: 'error',
            permission: { id: 'q2', status: 'canceled', kind: 'user_action', decision: 'abort' },
        } as Parameters<typeof makeToolCall>[0]);

        expect(resolveToolPermissionTerminalErrorMessage({ tool, metadata: null })).toBe('errors.permissionCanceled');
    });

    it('recognises a question row by tool name when kind is missing', async () => {
        const { resolveToolPermissionTerminalErrorMessage } = await import(
            '@/components/tools/shell/permissions/resolveToolPermissionTerminalErrorMessage'
        );

        const tool = makeToolCall({
            name: 'AskUserQuestion',
            state: 'error',
            result: { answers: { 'Samspil: Hvordan skal markeringen fungere?': 'Langt tryk = marker tekst' } },
            permission: { id: 'q3', status: 'canceled', decision: 'abort' },
        } as Parameters<typeof makeToolCall>[0]);

        expect(resolveToolPermissionTerminalErrorMessage({ tool, metadata: null })).toBeNull();
    });
});
