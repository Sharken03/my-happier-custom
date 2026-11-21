import { Platform } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const settings = {
    transcriptToolCallsGroupOpenMode: 'sheet',
    transcriptToolCallsGroupOpenModeWeb: 'list',
} as Record<string, unknown>;

let tauriDesktop = false;

vi.mock('@/sync/domains/state/storage', () => ({
    useSetting: (key: string) => settings[key],
}));

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => tauriDesktop,
}));

const originalPlatformOs = Platform.OS;

function setPlatform(os: 'ios' | 'web'): void {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

describe('useResolvedToolCallsGroupOpenMode', () => {
    afterEach(() => {
        standardCleanup();
        tauriDesktop = false;
        Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatformOs });
    });

    it('reads the app setting on native and the web setting on the web', async () => {
        const { useResolvedToolCallsGroupOpenMode } = await import('./useResolvedToolCallsGroupOpenMode');

        setPlatform('ios');
        expect((await renderHook(() => useResolvedToolCallsGroupOpenMode())).getCurrent()).toBe('sheet');

        setPlatform('web');
        expect((await renderHook(() => useResolvedToolCallsGroupOpenMode())).getCurrent()).toBe('list');
    });

    it('reads the app setting in the desktop shell, which also runs in a web view', async () => {
        const { useResolvedToolCallsGroupOpenMode } = await import('./useResolvedToolCallsGroupOpenMode');

        setPlatform('web');
        tauriDesktop = true;
        expect((await renderHook(() => useResolvedToolCallsGroupOpenMode())).getCurrent()).toBe('sheet');
    });
});
