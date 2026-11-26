import { describe, expect, it } from 'vitest';

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES } from './_all';
import { en } from './translations/en';
import { ensureLocaleTree, getLocaleTree } from './localeTrees.web';

/**
 * The web export ships only English in the entry chunk. These pin the two properties the boot gate
 * relies on: English never needs a load, and a language answers with English until its chunk lands.
 */
describe('web locale trees', () => {
    it('serves English synchronously and needs no chunk', async () => {
        expect(getLocaleTree(DEFAULT_LANGUAGE)).toBe(en);
        await expect(ensureLocaleTree(DEFAULT_LANGUAGE)).resolves.toBeUndefined();
    });

    it('answers with English until the language chunk lands, then with that language', async () => {
        const language = 'ru';
        expect(getLocaleTree(language)).toBe(en);

        await ensureLocaleTree(language);

        const russian = getLocaleTree(language);
        expect(russian).not.toBe(en);
        expect(russian.tabs.inbox).not.toBe(en.tabs.inbox);
        // A second load is served from the cache rather than re-imported.
        expect(getLocaleTree(language)).toBe(russian);
    });

    it('has a loader for every supported language', async () => {
        // getLocaleTree falls through to English for a language without a loader, so a missing entry
        // would only show up as an untranslated language. Load each one and check it is not English.
        for (const code of SUPPORTED_LANGUAGE_CODES) {
            await ensureLocaleTree(code);
            const tree = getLocaleTree(code);
            if (code === DEFAULT_LANGUAGE) {
                expect(tree).toBe(en);
            } else {
                expect(tree).not.toBe(en);
            }
        }
    });
});
