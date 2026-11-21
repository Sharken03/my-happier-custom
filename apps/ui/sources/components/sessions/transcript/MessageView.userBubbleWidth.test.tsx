import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installMessageViewCommonModuleMocks } from './messageViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installMessageViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'android', select: (values: Record<string, unknown>) => values?.android ?? values?.default },
        });
    },
    storage: async (importOriginal) => importOriginal(),
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key: string) => key });
    },
});

vi.mock('expo-clipboard', () => ({
    setStringAsync: vi.fn(async () => true),
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    Octicons: 'Octicons',
}));

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
    return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

async function renderUserMessage(narrow: boolean) {
    const { storage } = await import('@/sync/domains/state/storage');
    storage.setState((state) => ({ settings: { ...state.settings, transcriptUserBubbleNarrow: narrow } }));
    const { MessageView } = await import('./MessageView');
    const message: any = { kind: 'user-text', localId: 'local-1', id: 'm1', text: 'hello' };
    return renderScreen(<MessageView message={message} metadata={null} sessionId="s1" />);
}

describe('MessageView (user bubble width)', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('caps the user bubble at 80% of the row when the setting is on', async () => {
        const screen = await renderUserMessage(true);
        const aligner = screen.findByTestId('transcript-user-bubble:m1');
        if (!aligner) throw new Error('expected the user bubble aligner to render');
        expect(flattenStyle(aligner.props.style)).toMatchObject({ alignSelf: 'flex-end', maxWidth: '80%' });
    });

    it('lets the user bubble use the full row when the setting is off', async () => {
        const screen = await renderUserMessage(false);
        const aligner = screen.findByTestId('transcript-user-bubble:m1');
        if (!aligner) throw new Error('expected the user bubble aligner to render');
        expect(flattenStyle(aligner.props.style)).toMatchObject({ alignSelf: 'flex-end', maxWidth: '100%' });
    });
});
