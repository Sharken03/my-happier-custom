// Device QA only (exp/row-calibration): logs text shape, estimate and painted height of each
// text row on its first measurement. Logs counts, never the text.
import { Dimensions, PixelRatio } from 'react-native';

const CHARS_PER_LINE_GRID = [24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72] as const;

type TextShape = Readonly<{
    chars: number;
    lines: number;
    blank: number;
    prose: number;
    list: number;
    heading: number;
    quote: number;
    table: number;
    fence: number;
    fenceBlocks: number;
    paragraphs: number;
    wrapped: number[];
    fenceWrapped: number[];
}>;

function describeText(text: string): TextShape {
    const rows = text.split('\n');
    let blank = 0, prose = 0, list = 0, heading = 0, quote = 0, table = 0, fence = 0, fenceBlocks = 0, paragraphs = 0;
    const wrapped = CHARS_PER_LINE_GRID.map(() => 0);
    const fenceWrapped = CHARS_PER_LINE_GRID.map(() => 0);
    let inFence = false;
    let previousBlank = true;
    for (const row of rows) {
        const trimmed = row.trim();
        if (trimmed.startsWith('```')) {
            if (!inFence) fenceBlocks += 1;
            inFence = !inFence;
            previousBlank = false;
            continue;
        }
        if (inFence) {
            fence += 1;
            CHARS_PER_LINE_GRID.forEach((c, i) => { fenceWrapped[i] += Math.max(1, Math.ceil(row.length / c)); });
            continue;
        }
        if (trimmed.length === 0) {
            blank += 1;
            previousBlank = true;
            continue;
        }
        if (previousBlank) paragraphs += 1;
        previousBlank = false;
        if (/^\|/.test(trimmed)) { table += 1; continue; }
        if (/^#{1,6}\s/.test(trimmed)) heading += 1;
        else if (/^([-*+]|\d+[.)])\s/.test(trimmed)) list += 1;
        else if (trimmed.startsWith('>')) quote += 1;
        else prose += 1;
        CHARS_PER_LINE_GRID.forEach((c, i) => { wrapped[i] += Math.max(1, Math.ceil(trimmed.length / c)); });
    }
    return { chars: text.length, lines: rows.length, blank, prose, list, heading, quote, table, fence, fenceBlocks, paragraphs, wrapped, fenceWrapped };
}

const loggedRows = new Set<string>();

export function logRowEstimateCalibration(params: Readonly<{
    itemId: string;
    rowKind: string;
    heightPx: number;
    estimatePx: number | undefined;
    text: string | null;
    chatFont: string | undefined;
    uiFontScale: number | undefined;
}>): void {
    if (params.text === null || loggedRows.has(params.itemId)) return;
    loggedRows.add(params.itemId);
    const window = Dimensions.get('window');
    console.log('HAPPIER_ROW_CAL', JSON.stringify({
        kind: params.rowKind,
        h: params.heightPx,
        est: params.estimatePx ?? null,
        w: Math.round(window.width),
        fontScale: PixelRatio.getFontScale(),
        font: params.chatFont ?? null,
        uiFontScale: params.uiFontScale ?? null,
        grid: CHARS_PER_LINE_GRID,
        ...describeText(params.text),
    }));
}
