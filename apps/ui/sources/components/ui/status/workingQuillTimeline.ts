/**
 * One loop of the working quill mark: a quill writes three wavy lines on a page, the lines fade,
 * and the loop starts again. Native interpolation and the web keyframes read the same stops, so
 * both platforms draw the same motion.
 *
 * Units are the mark's 24-unit grid. Progress runs from 0 to 1; the value at 0 equals the value
 * at 1, so the loop has no jump.
 */

export const WORKING_QUILL_DURATION_MS = 3000;

/** Grid geometry of the page, the lines and the quill. */
export const WORKING_QUILL_GEOMETRY = {
    grid: 24,
    lineStartX: 6,
    lineWidth: 8,
    lineYs: [8.5, 12.5, 16.5] as const,
    /** The quill box is square; its nib is at the box's bottom-left corner. */
    penBox: 11,
} as const;

export type WorkingQuillStop = Readonly<{ at: number; value: number }>;

const WRITE_STARTS = [0.04, 0.33, 0.62] as const;
const WRITE_LENGTH = 0.22;
const WRITE_STEPS = 4;
/** Where the quill rests between loops, relative to the start of the first line. */
const REST = { x: 9.5, y: 2 } as const;

function lineOffsetY(index: number): number {
    return WORKING_QUILL_GEOMETRY.lineYs[index] - WORKING_QUILL_GEOMETRY.lineYs[0];
}

function buildPenStops(): { x: WorkingQuillStop[]; y: WorkingQuillStop[]; rotate: WorkingQuillStop[] } {
    const x: WorkingQuillStop[] = [{ at: 0, value: REST.x }];
    const y: WorkingQuillStop[] = [{ at: 0, value: REST.y }];
    const rotate: WorkingQuillStop[] = [{ at: 0, value: 0 }];
    WRITE_STARTS.forEach((start, line) => {
        for (let step = 0; step <= WRITE_STEPS; step += 1) {
            const at = start + (WRITE_LENGTH * step) / WRITE_STEPS;
            const lift = step % 2 === 1 ? -0.8 : 0;
            x.push({ at, value: (WORKING_QUILL_GEOMETRY.lineWidth * step) / WRITE_STEPS });
            y.push({ at, value: lineOffsetY(line) + lift });
            rotate.push({ at, value: step % 2 === 1 ? -6 : 4 });
        }
    });
    const lastEnd = WRITE_STARTS[WRITE_STARTS.length - 1] + WRITE_LENGTH;
    x.push({ at: lastEnd + 0.06, value: REST.x }, { at: 1, value: REST.x });
    y.push({ at: lastEnd + 0.06, value: REST.y }, { at: 1, value: REST.y });
    rotate.push({ at: lastEnd + 0.06, value: 0 }, { at: 1, value: 0 });
    return { x, y, rotate };
}

/** How much of each line is drawn, from 0 (none) to 1 (all). */
function buildLineRevealStops(line: number): WorkingQuillStop[] {
    const start = WRITE_STARTS[line];
    return [
        { at: 0, value: 0 },
        { at: start, value: 0 },
        { at: start + WRITE_LENGTH, value: 1 },
        { at: 0.97, value: 1 },
        { at: 0.98, value: 0 },
        { at: 1, value: 0 },
    ];
}

/** The written lines fade out together before the next loop draws them again. */
const LINES_OPACITY_STOPS: WorkingQuillStop[] = [
    { at: 0, value: 1 },
    { at: 0.92, value: 1 },
    { at: 0.97, value: 0 },
    { at: 0.99, value: 0 },
    { at: 1, value: 1 },
];

const PEN_STOPS = buildPenStops();

export const WORKING_QUILL_TIMELINE = {
    penX: PEN_STOPS.x,
    penY: PEN_STOPS.y,
    penRotate: PEN_STOPS.rotate,
    lineReveal: [buildLineRevealStops(0), buildLineRevealStops(1), buildLineRevealStops(2)] as const,
    linesOpacity: LINES_OPACITY_STOPS,
} as const;

/** Input and output ranges for an `Animated` interpolation, with each output mapped by `map`. */
export function toInterpolation(
    stops: readonly WorkingQuillStop[],
    map: (value: number) => number = (value) => value,
): { inputRange: number[]; outputRange: number[] } {
    return { inputRange: stops.map((stop) => stop.at), outputRange: stops.map((stop) => map(stop.value)) };
}

/** A CSS `@keyframes` rule with one frame per stop. */
export function toCssKeyframes(
    name: string,
    stops: readonly WorkingQuillStop[],
    declaration: (value: number) => string,
): string {
    const frames = stops.map((stop) => `  ${round(stop.at * 100)}% { ${declaration(stop.value)} }`);
    return [`@keyframes ${name} {`, ...frames, '}'].join('\n');
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}
