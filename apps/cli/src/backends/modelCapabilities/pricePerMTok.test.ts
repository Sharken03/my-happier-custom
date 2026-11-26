import { describe, expect, it } from 'vitest';

import { normalizePricePerMTok, readPricePerMTokFromCostRecord } from './pricePerMTok';

describe('normalizePricePerMTok', () => {
  it('keeps zero, which is how a free model is declared', () => {
    expect(normalizePricePerMTok(0)).toBe(0);
    expect(normalizePricePerMTok('0')).toBe(0);
  });

  it('rejects the catalog placeholders that are not real prices', () => {
    expect(normalizePricePerMTok(-1000000)).toBeUndefined();
    expect(normalizePricePerMTok(Number.NaN)).toBeUndefined();
    expect(normalizePricePerMTok(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizePricePerMTok('')).toBeUndefined();
    expect(normalizePricePerMTok('free')).toBeUndefined();
    expect(normalizePricePerMTok(null)).toBeUndefined();
  });

  it('reads Pi cost records and snake_case catalogs under the same rule', () => {
    expect(readPricePerMTokFromCostRecord({ input: 8, output: 40 }, 'input')).toBe(8);
    expect(readPricePerMTokFromCostRecord({ input: 8, output: 40 }, 'output')).toBe(40);
    expect(readPricePerMTokFromCostRecord({ cost_input_per_mtok: 0.5 }, 'input')).toBe(0.5);
    expect(readPricePerMTokFromCostRecord(null, 'input')).toBeUndefined();
  });
});
