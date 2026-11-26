import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';

const mocks = vi.hoisted(() => ({ ensureActiveTranslations: vi.fn<() => Promise<void>>() }));
vi.mock('@/text/i18n', () => ({ ensureActiveTranslations: mocks.ensureActiveTranslations }));

import { runAppBootSequence } from './runAppBootSequence';

const CREDENTIALS: AuthCredentials = { token: 'token-1', secret: 'secret-1' };

function bootEvents(events: string[], credentials: AuthCredentials | null) {
    return runAppBootSequence({
        loadFonts: async () => {},
        sodiumReady: Promise.resolve(),
        resolveCredentials: async () => credentials,
        prepareWarmCache: async () => {},
        prepareSessionDrafts: async () => {},
        restoreSync: async () => { events.push('restore'); },
        onReady: () => { events.push('ready'); },
    });
}

describe('runAppBootSequence translations', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.ensureActiveTranslations.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('loads the language after the sync restore that publishes it, before the first paint', async () => {
        const events: string[] = [];
        let releaseTranslations!: () => void;
        mocks.ensureActiveTranslations.mockImplementation(() => new Promise<void>((resolve) => {
            releaseTranslations = () => {
                events.push('translations');
                resolve();
            };
        }));

        const run = bootEvents(events, CREDENTIALS);
        await vi.advanceTimersByTimeAsync(0);
        expect(events).toEqual(['restore']);

        releaseTranslations();
        await run;
        expect(events).toEqual(['restore', 'translations', 'ready']);
    });

    it('paints in English instead of holding the splash when the language chunk stalls', async () => {
        const events: string[] = [];
        mocks.ensureActiveTranslations.mockImplementation(() => new Promise<void>(() => {}));

        const run = bootEvents(events, CREDENTIALS);
        await vi.advanceTimersByTimeAsync(1_500);
        await run;

        expect(events).toEqual(['restore', 'ready']);
        expect(console.error).toHaveBeenCalledWith(
            'Translations missed their boot deadline, painting in English:',
            expect.anything(),
        );
    });

    it('requests the language on a signed-out boot too', async () => {
        const events: string[] = [];
        mocks.ensureActiveTranslations.mockResolvedValue(undefined);

        await bootEvents(events, null);

        expect(mocks.ensureActiveTranslations).toHaveBeenCalledTimes(1);
        expect(events).toEqual(['ready']);
    });
});
