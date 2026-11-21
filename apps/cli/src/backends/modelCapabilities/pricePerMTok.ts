/**
 * USD per million tokens for a model, as the provider catalog declares it.
 *
 * The model picker derives its price level (`$` … `$$$$`) from these two numbers, so one
 * normalizer owns what counts as a usable price. Zero is a real price (a free model); a
 * negative or non-finite value is a placeholder the catalog does not mean literally and is
 * reported as absent, which the picker renders as "unknown".
 */
function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

export function normalizePricePerMTok(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : undefined;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    }

    return undefined;
}

/**
 * Read a provider's `cost` record. Pi's `cost` is already per million tokens
 * (`input`, `output`, `cacheRead`, `cacheWrite`); other catalogs use snake_case.
 */
export function readPricePerMTokFromCostRecord(
    cost: unknown,
    direction: 'input' | 'output',
): number | undefined {
    const record = asRecord(cost);
    if (!record) return undefined;
    const keys = direction === 'input'
        ? ['input', 'inputPrice', 'prompt', 'promptPrice', 'costInputPerMTok', 'cost_input_per_mtok']
        : ['output', 'outputPrice', 'completion', 'completionPrice', 'costOutputPerMTok', 'cost_output_per_mtok'];
    for (const key of keys) {
        const normalized = normalizePricePerMTok(record[key]);
        if (normalized !== undefined) return normalized;
    }
    return undefined;
}
