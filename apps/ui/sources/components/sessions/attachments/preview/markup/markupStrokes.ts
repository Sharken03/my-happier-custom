/**
 * Freehand markup model for the image viewer. Points and widths are relative to the image
 * (0..1), so the same strokes draw on the screen and on the full-size output image.
 */

export type MarkupPoint = Readonly<{ x: number; y: number }>;

export type MarkupStroke = Readonly<{
    color: string;
    /** Line width as a fraction of the image width. */
    width: number;
    points: ReadonlyArray<MarkupPoint>;
}>;

export type MarkupSize = Readonly<{ width: number; height: number }>;

export const MARKUP_COLORS: ReadonlyArray<string> = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000'];
export const MARKUP_STROKE_WIDTH = 0.008;
export const MARKUP_MAX_OUTPUT_EDGE_PX = 2048;
const MIN_POINT_DISTANCE = 0.002;
const DOT_LENGTH_PX = 0.01;

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

export function toMarkupPoint(x: number, y: number, box: MarkupSize): MarkupPoint {
    if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
    return { x: clamp01(x / box.width), y: clamp01(y / box.height) };
}

/** Returns the same array when the point is too close to the last point. */
export function appendMarkupPoint(points: ReadonlyArray<MarkupPoint>, point: MarkupPoint): ReadonlyArray<MarkupPoint> {
    const last = points[points.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_DISTANCE) return points;
    return [...points, point];
}

function formatPx(value: number): string {
    return String(Math.round(value * 100) / 100);
}

export function markupStrokeToSvgPath(stroke: MarkupStroke, width: number, height: number): string {
    const [first, ...rest] = stroke.points;
    if (!first) return '';
    const start = `M${formatPx(first.x * width)} ${formatPx(first.y * height)}`;
    if (rest.length === 0) {
        return `${start} L${formatPx(first.x * width + DOT_LENGTH_PX)} ${formatPx(first.y * height)}`;
    }
    return [start, ...rest.map((point) => `L${formatPx(point.x * width)} ${formatPx(point.y * height)}`)].join(' ');
}

/** The part of CanvasRenderingContext2D that the markup uses. */
export type MarkupCanvasContext = {
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
    lineCap: string;
    lineJoin: string;
    lineWidth: number;
    strokeStyle: unknown;
};

export function drawMarkupStrokes(
    ctx: MarkupCanvasContext,
    strokes: ReadonlyArray<MarkupStroke>,
    width: number,
    height: number,
): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
        const [first, ...rest] = stroke.points;
        if (!first) continue;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width * width;
        ctx.beginPath();
        ctx.moveTo(first.x * width, first.y * height);
        if (rest.length === 0) {
            ctx.lineTo(first.x * width + DOT_LENGTH_PX, first.y * height);
        }
        for (const point of rest) ctx.lineTo(point.x * width, point.y * height);
        ctx.stroke();
    }
}

export function resolveMarkupOutputSize(image: MarkupSize): MarkupSize {
    const longEdge = Math.max(image.width, image.height);
    if (longEdge <= MARKUP_MAX_OUTPUT_EDGE_PX || longEdge <= 0) {
        return { width: Math.round(image.width), height: Math.round(image.height) };
    }
    const ratio = MARKUP_MAX_OUTPUT_EDGE_PX / longEdge;
    return { width: Math.round(image.width * ratio), height: Math.round(image.height * ratio) };
}
