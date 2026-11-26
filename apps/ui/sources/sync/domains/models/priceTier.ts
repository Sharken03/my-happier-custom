import { t } from '@/text';

/**
 * The price level shown in the model picker.
 *
 * One owner for the band rule: the thresholds live here and nowhere else, because the same
 * numbers decide what the user sees on every surface that renders a model row.
 *
 * The level is a property of the model, not of the selected thinking level. Reasoning tokens
 * are billed at the output rate, so a higher effort level buys more output tokens rather than
 * a different rate. See docs/model-price-tiers.md.
 */
export type ModelPriceTier = 'free' | 'unknown' | '$' | '$$' | '$$$' | '$$$$';

/**
 * Blend used for the band: input plus three times output, the typical session mix. Prices are
 * log-normally distributed across the OpenRouter catalog, so the thresholds are geometric —
 * each step is roughly ×5.7 — instead of linear.
 */
const BLEND_OUTPUT_WEIGHT = 3;
const BAND_THRESHOLDS = [1.25, 5, 36] as const;

function readPrice(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * USD per million tokens in, USD per million tokens out.
 *
 * A model with no prices is `unknown`, not `$`: an unpriced model is not a cheap one, and a
 * free model is the only thing that may claim the free level.
 */
export function readModelPriceTier(params: Readonly<{
    costInputPerMTok?: unknown;
    costOutputPerMTok?: unknown;
}>): ModelPriceTier {
    const input = readPrice(params.costInputPerMTok);
    const output = readPrice(params.costOutputPerMTok);
    if (input === null || output === null) return 'unknown';
    if (input === 0 && output === 0) return 'free';
    const blend = input + BLEND_OUTPUT_WEIGHT * output;
    const level = 1 + BAND_THRESHOLDS.filter((threshold) => blend > threshold).length;
    return `$$$$$$$$`.slice(0, level) as ModelPriceTier;
}

/**
 * What a row shows for a model: the glyph and what a screen reader should say instead.
 *
 * Free and unpriced models show nothing and announce nothing, so every surface that renders a
 * price gets the display decision from one place.
 */
export function readModelPriceDisplay(params: Readonly<{
    costInputPerMTok?: unknown;
    costOutputPerMTok?: unknown;
}>): Readonly<{ tier: ModelPriceTier; symbol: string | null; accessibilityLabel: string | null }> {
    const tier = readModelPriceTier(params);
    if (tier === 'free' || tier === 'unknown') return { tier, symbol: null, accessibilityLabel: null };
    // The symbols alone read as "dollar dollar dollar"; a level announcement is useful.
    return { tier, symbol: tier, accessibilityLabel: `${t('usage.cost')}: ${tier.length}/4` };
}
