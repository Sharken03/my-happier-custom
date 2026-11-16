import { Platform } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let tauriDesktop = false;

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => tauriDesktop,
}));

const originalPlatformOs = Platform.OS;

function setPlatform(os: 'ios' | 'web'): void {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

describe('isBrowserWebClient', () => {
    afterEach(() => {
        tauriDesktop = false;
        Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatformOs });
    });

    it('is true in a browser tab and false on native', async () => {
        const { isBrowserWebClient } = await import('./browserWeb');

        setPlatform('web');
        expect(isBrowserWebClient()).toBe(true);

        setPlatform('ios');
        expect(isBrowserWebClient()).toBe(false);
    });

    it('is false in the desktop shell, which also runs in a web view', async () => {
        const { isBrowserWebClient } = await import('./browserWeb');

        setPlatform('web');
        tauriDesktop = true;
        expect(isBrowserWebClient()).toBe(false);
    });
});
