import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const dismissKeyboard = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Keyboard: { addListener: () => ({ remove: () => {} }), dismiss: dismissKeyboard },
        useWindowDimensions: () => ({ width: 400, height: 800, scale: 1, fontScale: 1 }),
    });
});

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    const mock = createReanimatedModuleMock();
    return { ...mock, scrollTo: () => {}, useAnimatedScrollHandler: () => () => {} };
});

vi.mock('react-native-gesture-handler', async () => {
    const React = await import('react');
    // Every method of a gesture chain returns the chain, so the sheet can configure it freely.
    const chain = (): unknown => new Proxy({}, { get: (_target, _key, receiver) => () => receiver });
    return {
        Gesture: { Pan: chain, Native: chain },
        GestureDetector: (props: { children?: React.ReactNode }) =>
            React.createElement('GestureDetector', null, props.children),
    };
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/components/ui/text/nativeTextSelection', () => ({
    NativeTextSelectionSuppressionScope: (props: { children?: React.ReactNode }) => props.children,
}));

afterEach(() => {
    standardCleanup();
    dismissKeyboard.mockClear();
});

describe('ToolCallsBottomSheet', () => {
    it('closes the keyboard when it opens, so the keyboard does not cover the sheet', async () => {
        const { ToolCallsBottomSheet } = await import('./ToolCallsBottomSheet');

        await renderScreen(<ToolCallsBottomSheet onClosed={() => {}}>{null}</ToolCallsBottomSheet>);

        expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    });
});
