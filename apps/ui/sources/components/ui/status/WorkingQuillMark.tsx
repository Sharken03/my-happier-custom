import * as React from 'react';
import { Animated, Easing, Platform, View, type ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { useIsHostVisible } from '@/hooks/ui/useIsHostVisible';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

import {
    WORKING_QUILL_DURATION_MS,
    WORKING_QUILL_GEOMETRY as GEOMETRY,
    WORKING_QUILL_TIMELINE as TIMELINE,
    toCssKeyframes,
    toInterpolation,
    type WorkingQuillStop,
} from './workingQuillTimeline';

export type WorkingQuillMarkProps = Readonly<{
    /** Colour of the page and the written lines. */
    inkColor: string;
    /** Colour of the quill. */
    quillColor: string;
    size?: number;
    style?: ViewStyle;
    testID?: string;
}>;

const LINE_WAVE = 'M0.7 1.5 q0.83 -1.5 1.65 0 t1.65 0 t1.65 0 t1.65 0';
const QUILL_VANE = 'M10.6 0.4 C6.2 0.8 2.2 3.6 2.4 8.6 C7.4 8.4 10.2 4.8 10.6 0.4 Z';
/** Height of one line's box; the wave and its stroke fit inside it. */
const LINE_HEIGHT = 3;
const QUILL_SHAFT = 'M10.6 0.4 L0.6 10.4';

/**
 * A quill that writes lines on a page while an agent works. It runs on the native driver or as a
 * CSS animation, so the JavaScript thread does no per-frame work. It stops while the window is
 * hidden and shows a still page with all lines when reduced motion is requested.
 */
export const WorkingQuillMark = React.memo(function WorkingQuillMark(props: WorkingQuillMarkProps) {
    const hostVisible = useIsHostVisible();
    const reducedMotion = useReducedMotionPreference();
    const animate = hostVisible && !reducedMotion;
    const size = props.size ?? 16;
    const unit = size / GEOMETRY.grid;

    if (Platform.OS === 'web') {
        return <WebWorkingQuillMark {...props} size={size} unit={unit} animate={animate} />;
    }
    return <NativeWorkingQuillMark {...props} size={size} unit={unit} animate={animate} />;
});

type LayerProps = WorkingQuillMarkProps & Readonly<{ size: number; unit: number; animate: boolean }>;

function NativeWorkingQuillMark(props: LayerProps) {
    const progress = React.useRef(new Animated.Value(STILL_PROGRESS)).current;

    React.useEffect(() => {
        if (!props.animate) {
            progress.setValue(STILL_PROGRESS);
            return;
        }
        progress.setValue(0);
        const animation = Animated.loop(Animated.timing(progress, {
            toValue: 1,
            duration: WORKING_QUILL_DURATION_MS,
            easing: Easing.linear,
            useNativeDriver: true,
        }));
        animation.start();
        return () => animation.stop();
    }, [progress, props.animate]);

    const { unit } = props;
    const lineWidth = GEOMETRY.lineWidth * unit;
    const interpolate = (stops: readonly WorkingQuillStop[], map?: (value: number) => number) =>
        progress.interpolate(toInterpolation(stops, map));

    return (
        <View testID={props.testID} style={[{ width: props.size, height: props.size }, props.style]}>
            <Page {...props} />
            <Animated.View style={[fill, { opacity: interpolate(TIMELINE.linesOpacity) }]}>
                {TIMELINE.lineReveal.map((stops, line) => (
                    <Animated.View
                        key={line}
                        style={[lineClip(line, unit), { transform: [{ translateX: interpolate(stops, (r) => (r - 1) * lineWidth) }] }]}
                    >
                        <Animated.View style={{ transform: [{ translateX: interpolate(stops, (r) => (1 - r) * lineWidth) }] }}>
                            <Line {...props} />
                        </Animated.View>
                    </Animated.View>
                ))}
            </Animated.View>
            <Animated.View
                style={[penBox(unit), {
                    transform: [
                        { translateX: interpolate(TIMELINE.penX, (x) => x * unit) },
                        { translateY: interpolate(TIMELINE.penY, (y) => y * unit) },
                        { rotate: progress.interpolate({ ...toInterpolation(TIMELINE.penRotate), outputRange: TIMELINE.penRotate.map((stop) => `${stop.value}deg`) }) },
                    ],
                }]}
            >
                <Quill {...props} />
            </Animated.View>
        </View>
    );
}

function WebWorkingQuillMark(props: LayerProps) {
    injectWebKeyframes();
    const { unit, animate } = props;
    const run = (name: string): WebAnimationStyle => animate
        ? { animationName: name, animationDuration: `${WORKING_QUILL_DURATION_MS}ms`, animationIterationCount: 'infinite', animationTimingFunction: 'linear' }
        : {};
    return (
        <View testID={props.testID} style={[{ width: props.size, height: props.size }, props.style]}>
            <Page {...props} />
            <View style={[fill, run(WEB_NAMES.linesOpacity)]}>
                {TIMELINE.lineReveal.map((_stops, line) => (
                    <View key={line} style={[lineClip(line, unit), run(WEB_NAMES.lineOuter[line])]}>
                        <View style={run(WEB_NAMES.lineInner[line])}>
                            <Line {...props} />
                        </View>
                    </View>
                ))}
            </View>
            <View testID={props.testID ? `${props.testID}-quill` : undefined} style={[penBox(unit), animate ? run(WEB_NAMES.pen) : stillPenStyle(unit)]}>
                <Quill {...props} />
            </View>
        </View>
    );
}

function Page(props: LayerProps) {
    return (
        <Svg width={props.size} height={props.size} viewBox={`0 0 ${GEOMETRY.grid} ${GEOMETRY.grid}`} style={fill}>
            <Rect x={3} y={3.5} width={14} height={17.5} rx={2} fill="none" stroke={props.inkColor} strokeWidth={1.6} />
        </Svg>
    );
}

function Line(props: LayerProps) {
    const { unit } = props;
    return (
        <Svg width={GEOMETRY.lineWidth * unit} height={LINE_HEIGHT * unit} viewBox={`0 0 ${GEOMETRY.lineWidth} ${LINE_HEIGHT}`}>
            <Path d={LINE_WAVE} fill="none" stroke={props.inkColor} strokeWidth={1.4} strokeLinecap="round" />
        </Svg>
    );
}

function Quill(props: LayerProps) {
    const box = GEOMETRY.penBox * props.unit;
    return (
        <Svg width={box} height={box} viewBox={`0 0 ${GEOMETRY.penBox} ${GEOMETRY.penBox}`}>
            <Path d={QUILL_VANE} fill={props.quillColor} />
            <Path d={QUILL_SHAFT} fill="none" stroke={props.quillColor} strokeWidth={1.2} strokeLinecap="round" />
        </Svg>
    );
}

/** Progress shown when the mark is still: all lines written and the quill at rest. */
const STILL_PROGRESS = 0.9;

const fill: ViewStyle = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 };

function lineClip(line: number, unit: number): ViewStyle {
    return {
        position: 'absolute',
        left: GEOMETRY.lineStartX * unit,
        top: (GEOMETRY.lineYs[line] - LINE_HEIGHT / 2) * unit,
        width: GEOMETRY.lineWidth * unit,
        height: LINE_HEIGHT * unit,
        overflow: 'hidden',
    };
}

/** The quill box sits so that its nib, at the box's bottom-left corner, starts the first line. */
function penBox(unit: number): ViewStyle {
    return {
        position: 'absolute',
        left: (GEOMETRY.lineStartX - 0.6) * unit,
        top: (GEOMETRY.lineYs[0] - GEOMETRY.penBox + 0.6) * unit,
        width: GEOMETRY.penBox * unit,
        height: GEOMETRY.penBox * unit,
    };
}

function stillPenStyle(unit: number): ViewStyle {
    const at = (stops: readonly WorkingQuillStop[]) => valueAt(stops, STILL_PROGRESS);
    return { transform: [{ translateX: at(TIMELINE.penX) * unit }, { translateY: at(TIMELINE.penY) * unit }] };
}

function valueAt(stops: readonly WorkingQuillStop[], at: number): number {
    for (let index = 1; index < stops.length; index += 1) {
        const previous = stops[index - 1];
        const next = stops[index];
        if (at <= next.at) {
            const span = next.at - previous.at;
            return span === 0 ? next.value : previous.value + ((next.value - previous.value) * (at - previous.at)) / span;
        }
    }
    return stops[stops.length - 1].value;
}

type WebAnimationStyle = ViewStyle & {
    animationName?: string;
    animationDuration?: string;
    animationIterationCount?: string;
    animationTimingFunction?: string;
};

const WEB_NAMES = {
    linesOpacity: 'happierQuillLinesOpacity',
    lineOuter: ['happierQuillLine0Outer', 'happierQuillLine1Outer', 'happierQuillLine2Outer'],
    lineInner: ['happierQuillLine0Inner', 'happierQuillLine1Inner', 'happierQuillLine2Inner'],
    pen: 'happierQuillPen',
} as const;

const WEB_STYLE_ID = 'happier-working-quill-style';
let webKeyframesInjected = false;

/**
 * The web keyframes use percentages of each element's own box, so one rule set serves every size:
 * a line clip and its content are one line wide, and the quill box is `penBox` grid units wide.
 */
function injectWebKeyframes(): void {
    if (webKeyframesInjected || typeof document === 'undefined') return;
    webKeyframesInjected = true;
    if (document.getElementById(WEB_STYLE_ID)) return;
    const penPercent = (units: number) => (units / GEOMETRY.penBox) * 100;
    const penFrames = TIMELINE.penX.map((stop, index) => {
        const x = penPercent(stop.value);
        const y = penPercent(TIMELINE.penY[index].value);
        return `  ${Math.round(stop.at * 100000) / 1000}% { transform: translate(${x}%, ${y}%) rotate(${TIMELINE.penRotate[index].value}deg); }`;
    });
    const rules = [
        toCssKeyframes(WEB_NAMES.linesOpacity, TIMELINE.linesOpacity, (value) => `opacity: ${value};`),
        ...TIMELINE.lineReveal.map((stops, line) => toCssKeyframes(WEB_NAMES.lineOuter[line], stops, (r) => `transform: translateX(${(r - 1) * 100}%);`)),
        ...TIMELINE.lineReveal.map((stops, line) => toCssKeyframes(WEB_NAMES.lineInner[line], stops, (r) => `transform: translateX(${(1 - r) * 100}%);`)),
        [`@keyframes ${WEB_NAMES.pen} {`, ...penFrames, '}'].join('\n'),
    ];
    const style = document.createElement('style');
    style.id = WEB_STYLE_ID;
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
}
