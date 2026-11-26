import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installMessageViewCommonModuleMocks } from './messageViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const pressMessageOption = vi.hoisted(() => vi.fn(async () => {}));

installMessageViewCommonModuleMocks({
    storage: async (importOriginal) => importOriginal(),
});

vi.mock('@/components/sessions/transcript/options/pressMessageOption', () => ({ pressMessageOption }));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    Octicons: 'Octicons',
}));

describe('MessageView option press', () => {
    // The first import compiles the whole transcript graph, which can take longer than one test may.
    beforeAll(async () => {
        await import('./MessageView');
    }, 240_000);

    afterEach(() => {
        standardCleanup();
        pressMessageOption.mockClear();
    });

    it.each(['user-text', 'agent-text'] as const)('hands a pressed option of a %s message to the option owner', async (kind) => {
        const { MessageView } = await import('./MessageView');
        const message: any = {
            kind,
            localId: 'local-1',
            id: 'm1',
            text: ['<options>', '<option>Run command</option>', '</options>'].join('\n'),
        };
        const interaction: any = { canSendMessages: true, canApprovePermissions: true };

        const screen = await renderScreen(
            <MessageView message={message} metadata={null} sessionId="s1" interaction={interaction} />,
        );
        const [option] = screen.findAll((node) => typeof node.type === 'string'
            && String(node.type) === 'Pressable'
            && typeof node.props.onPress === 'function'
            && typeof node.props.onLongPress === 'function');
        expect(option).toBeDefined();
        await act(async () => { option.props.onPress(); });

        expect(pressMessageOption).toHaveBeenCalledWith({
            sessionId: 's1',
            title: 'Run command',
            canSendMessages: true,
        });
    });
});
