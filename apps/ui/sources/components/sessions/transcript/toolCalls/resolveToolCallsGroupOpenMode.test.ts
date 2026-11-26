import { describe, expect, it } from 'vitest';

import { resolveToolCallsGroupOpenModeForPlatform } from './resolveToolCallsGroupOpenMode';

describe('resolveToolCallsGroupOpenModeForPlatform', () => {
    it('reads the app setting on the app and the web setting on the web', () => {
        const modes = { appMode: 'sheet', webMode: 'list', isWeb: false } as const;
        expect(resolveToolCallsGroupOpenModeForPlatform(modes)).toBe('sheet');
        expect(resolveToolCallsGroupOpenModeForPlatform({ ...modes, isWeb: true })).toBe('list');
    });

    it('keeps the two settings independent when they hold the same value', () => {
        for (const mode of ['inline', 'list', 'sheet'] as const) {
            expect(resolveToolCallsGroupOpenModeForPlatform({ appMode: mode, webMode: 'inline', isWeb: false })).toBe(mode);
            expect(resolveToolCallsGroupOpenModeForPlatform({ appMode: 'inline', webMode: mode, isWeb: true })).toBe(mode);
            expect(resolveToolCallsGroupOpenModeForPlatform({ appMode: mode, webMode: mode, isWeb: true })).toBe(mode);
        }
    });
});
