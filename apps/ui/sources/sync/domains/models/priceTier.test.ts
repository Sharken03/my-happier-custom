import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});
import { readModelPriceDisplay, readModelPriceTier } from './priceTier';

describe('readModelPriceTier', () => {
    it('reserves the free level for models priced at zero on both sides', () => {
        expect(readModelPriceTier({ costInputPerMTok: 0, costOutputPerMTok: 0 })).toBe('free');
    });

    it('reports an unknown level when a price is missing or unusable', () => {
        expect(readModelPriceTier({})).toBe('unknown');
        expect(readModelPriceTier({ costInputPerMTok: 0.5 })).toBe('unknown');
        expect(readModelPriceTier({ costInputPerMTok: 0.5, costOutputPerMTok: null })).toBe('unknown');
        expect(readModelPriceTier({ costInputPerMTok: -1, costOutputPerMTok: 2 })).toBe('unknown');
        expect(readModelPriceTier({ costInputPerMTok: 0.5, costOutputPerMTok: Number.NaN })).toBe('unknown');
    });

    it('bands the blend of input plus three times output', () => {
        // The current catalog, so the operator-visible rows stay pinned to this rule.
        expect(readModelPriceTier({ costInputPerMTok: 0.09, costOutputPerMTok: 0.18 })).toBe('$');
        expect(readModelPriceTier({ costInputPerMTok: 0.1, costOutputPerMTok: 0.5 })).toBe('$$');
        expect(readModelPriceTier({ costInputPerMTok: 2, costOutputPerMTok: 6 })).toBe('$$$');
        expect(readModelPriceTier({ costInputPerMTok: 4, costOutputPerMTok: 20 })).toBe('$$$$');
        expect(readModelPriceTier({ costInputPerMTok: 8, costOutputPerMTok: 40 })).toBe('$$$$');
    });

    it('does not band on the input price alone', () => {
        // Cheap input, expensive output: kimi-k3.1-pro would otherwise read as cheap.
        expect(readModelPriceTier({ costInputPerMTok: 0.25, costOutputPerMTok: 8.8 })).toBe('$$$');
    });

    it('keeps every band reachable at its boundary', () => {
        expect(readModelPriceTier({ costInputPerMTok: 0, costOutputPerMTok: 0.4 })).toBe('$');
        expect(readModelPriceTier({ costInputPerMTok: 0, costOutputPerMTok: 2.3 })).toBe('$$');
        expect(readModelPriceTier({ costInputPerMTok: 0, costOutputPerMTok: 12 })).toBe('$$$');
        expect(readModelPriceTier({ costInputPerMTok: 0, costOutputPerMTok: 12.1 })).toBe('$$$$');
    });

    it('ignores the thinking level: the caller never passes one', () => {
        // A reasoning-heavy model bills reasoning tokens at the output rate, so the band is
        // a property of the model. There is deliberately no effort argument to pass.
        expect(readModelPriceTier.length).toBe(1);
    });
});

describe('readModelPriceDisplay', () => {
    it('gives paid rows a glyph and a spoken level', () => {
        expect(readModelPriceDisplay({ costInputPerMTok: 2, costOutputPerMTok: 6 })).toEqual({
            tier: '$$$', symbol: '$$$', accessibilityLabel: 'usage.cost: 3/4',
        });
    });

    it('shows and says nothing for free and unpriced models', () => {
        expect(readModelPriceDisplay({ costInputPerMTok: 0, costOutputPerMTok: 0 })).toEqual({
            tier: 'free', symbol: null, accessibilityLabel: null,
        });
        expect(readModelPriceDisplay({})).toEqual({
            tier: 'unknown', symbol: null, accessibilityLabel: null,
        });
    });
});
