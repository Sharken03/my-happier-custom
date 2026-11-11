import { describe, expect, it } from 'vitest';

import { resolveFontScaleKey, resolveTranscriptRowPresentationKey } from './rowRenderKeys';

describe('resolveTranscriptRowPresentationKey', () => {
    const base = { chatFont: 'default', thinkingDisplayMode: 'inline', thinkingInlineChrome: 'plain' } as const;

    it('starts with the font scale key', () => {
        expect(resolveTranscriptRowPresentationKey(base).startsWith(resolveFontScaleKey())).toBe(true);
    });

    // A row height measured in one chat font is not the height of that row in the other font.
    it('gives each chat font its own key', () => {
        expect(resolveTranscriptRowPresentationKey({ ...base, chatFont: 'dm-sans' }))
            .not.toBe(resolveTranscriptRowPresentationKey(base));
    });

    // A thinking row measured while hidden (1 px) is not its height as a row or a card.
    it('gives each thinking presentation its own key', () => {
        const keys = new Set([
            resolveTranscriptRowPresentationKey(base),
            resolveTranscriptRowPresentationKey({ ...base, thinkingDisplayMode: 'hidden' }),
            resolveTranscriptRowPresentationKey({ ...base, thinkingDisplayMode: 'tool' }),
            resolveTranscriptRowPresentationKey({ ...base, thinkingInlineChrome: 'card' }),
        ]);
        expect(keys.size).toBe(4);
    });
});
