// Device QA only (exp/subview-measure): attributes a 1 dp drift in a transcript row to one of its
// sub-views.
//
// The open symptom: while a reply streams, the list sits 1.33 dp (4 px on the 8T) away from the
// bottom and re-measures push it around by 1-2 px. Legend cannot explain it — its size rounding was
// ruled out — so the drift has to be inside the row. This logs the measured height of each part
// (`row`, `text`, `actions`) whenever it CHANGES, with full dp precision, so a re-measure that
// comes back different with unchanged content names the guilty part.
//
// Logs numbers only: no message text, no ids beyond the message id already in the log stream.
import { PixelRatio } from 'react-native';

export type RowSubviewPart = 'row' | 'text' | 'actions';

type LayoutEvent = Readonly<{
    nativeEvent: Readonly<{
        layout: Readonly<{ width: number; height: number }>;
    }>;
}>;

const lastHeightByKey = new Map<string, number>();
let environmentLogged = false;

function logEnvironmentOnce(): void {
    if (environmentLogged) return;
    environmentLogged = true;
    console.log(`HAPPIER_SUBVIEW_ENV ${JSON.stringify({
        pixelRatio: PixelRatio.get(),
        fontScale: PixelRatio.getFontScale(),
        roundToNearestPixel1: PixelRatio.roundToNearestPixel(1),
        roundToNearestPixel13: PixelRatio.roundToNearestPixel(1.3333),
    })}`);
}

/** An `onLayout` handler for one part of a row; logs only when its measured height moves. */
export function createRowSubviewProbe(messageId: string, part: RowSubviewPart) {
    const key = `${messageId}|${part}`;
    return (event: LayoutEvent): void => {
        const height = event?.nativeEvent?.layout?.height;
        if (typeof height !== 'number' || !Number.isFinite(height)) return;
        logEnvironmentOnce();
        const previous = lastHeightByKey.get(key);
        if (previous !== undefined && Math.abs(previous - height) < 0.0005) return;
        lastHeightByKey.set(key, height);
        console.log(`HAPPIER_SUBVIEW ${JSON.stringify({
            id: messageId,
            part,
            height,
            previous: previous ?? null,
            delta: previous === undefined ? null : Number((height - previous).toFixed(4)),
            width: event.nativeEvent.layout.width,
        })}`);
    };
}
