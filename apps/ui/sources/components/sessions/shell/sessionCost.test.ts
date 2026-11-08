import { describe, expect, it } from 'vitest';
import { formatSessionCostUsd } from './sessionCost';

describe('formatSessionCostUsd', () => {
    it('shows three decimals below ten cents, two above, and nothing without a cost', () => {
        expect(formatSessionCostUsd(0.0423)).toBe('$0.042');
        expect(formatSessionCostUsd(0.1)).toBe('$0.10');
        expect(formatSessionCostUsd(12.345)).toBe('$12.35');
        expect(formatSessionCostUsd(0)).toBeNull();
        expect(formatSessionCostUsd(null)).toBeNull();
        expect(formatSessionCostUsd(Number.NaN)).toBeNull();
    });
});
