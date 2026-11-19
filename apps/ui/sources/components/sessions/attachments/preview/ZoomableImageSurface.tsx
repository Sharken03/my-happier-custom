import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import {
    clampImageZoomScale,
    clampImageZoomTranslation,
    fitImageInBox,
    isImageZoomed,
    resolveDoubleTapZoom,
    type ImageZoomSize,
} from './imageZoomMath';

const ZOOM_ANIMATION_MS = 200;
const DOUBLE_TAP_MAX_DELAY_MS = 260;

/**
 * Pinch, double tap and pan zoom for one image in the fullscreen viewer.
 * The pan is on only while the image is zoomed, so a horizontal drag at 1x still swipes the
 * gallery, and a drag while zoomed moves the image. The parent turns the gallery swipe off
 * while `onZoomedChange(true)` holds.
 */
export const ZoomableImageSurface = React.memo(function ZoomableImageSurface(props: Readonly<{
    children: React.ReactNode;
    /** Only the current slide zooms. A slide that stops being current returns to 1x. */
    active: boolean;
    /** The natural image size, when known. It limits how far the zoomed image can move. */
    imageSize: ImageZoomSize | null;
    onZoomedChange?: (zoomed: boolean) => void;
    onSingleTap?: () => void;
    testID?: string;
}>) {
    const [zoomed, setZoomed] = React.useState(false);
    const [box, setBox] = React.useState<ImageZoomSize>({ width: 0, height: 0 });
    const content = React.useMemo(() => fitImageInBox(box, props.imageSize), [box, props.imageSize]);

    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);

    const onZoomedChange = props.onZoomedChange;
    const onSingleTap = props.onSingleTap;
    const active = props.active;

    React.useEffect(() => {
        if (active) onZoomedChange?.(zoomed);
    }, [active, onZoomedChange, zoomed]);

    React.useEffect(() => {
        if (active) return;
        scale.value = 1;
        savedScale.value = 1;
        translateX.value = 0;
        translateY.value = 0;
        setZoomed(false);
    }, [active, savedScale, scale, translateX, translateY]);

    const handleSingleTap = React.useCallback(() => {
        onSingleTap?.();
    }, [onSingleTap]);

    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    }, []);

    const gesture = React.useMemo(() => {
        const pinch = Gesture.Pinch()
            .enabled(active)
            .onStart(() => {
                'worklet';
                savedScale.value = scale.value;
                savedTranslateX.value = translateX.value;
                savedTranslateY.value = translateY.value;
            })
            .onUpdate((event: { scale: number }) => {
                'worklet';
                const nextScale = clampImageZoomScale(savedScale.value * event.scale);
                const next = clampImageZoomTranslation({
                    scale: nextScale,
                    x: savedTranslateX.value,
                    y: savedTranslateY.value,
                    box,
                    content,
                });
                scale.value = nextScale;
                translateX.value = next.x;
                translateY.value = next.y;
            })
            .onEnd(() => {
                'worklet';
                const isZoomed = isImageZoomed(scale.value);
                if (!isZoomed) {
                    scale.value = withTiming(1, { duration: ZOOM_ANIMATION_MS });
                    translateX.value = withTiming(0, { duration: ZOOM_ANIMATION_MS });
                    translateY.value = withTiming(0, { duration: ZOOM_ANIMATION_MS });
                }
                runOnJS(setZoomed)(isZoomed);
            });

        const pan = Gesture.Pan()
            .enabled(active && zoomed)
            .maxPointers(1)
            .onStart(() => {
                'worklet';
                savedTranslateX.value = translateX.value;
                savedTranslateY.value = translateY.value;
            })
            .onUpdate((event: { translationX: number; translationY: number }) => {
                'worklet';
                const next = clampImageZoomTranslation({
                    scale: scale.value,
                    x: savedTranslateX.value + event.translationX,
                    y: savedTranslateY.value + event.translationY,
                    box,
                    content,
                });
                translateX.value = next.x;
                translateY.value = next.y;
            });

        const doubleTap = Gesture.Tap()
            .enabled(active)
            .numberOfTaps(2)
            .maxDelay(DOUBLE_TAP_MAX_DELAY_MS)
            .onEnd((event: { x: number; y: number }, success?: boolean) => {
                'worklet';
                if (success === false) return;
                const target = resolveDoubleTapZoom({
                    scale: scale.value,
                    focalX: event.x,
                    focalY: event.y,
                    box,
                    content,
                });
                scale.value = withTiming(target.scale, { duration: ZOOM_ANIMATION_MS });
                translateX.value = withTiming(target.x, { duration: ZOOM_ANIMATION_MS });
                translateY.value = withTiming(target.y, { duration: ZOOM_ANIMATION_MS });
                runOnJS(setZoomed)(isImageZoomed(target.scale));
            });

        const singleTap = Gesture.Tap()
            .numberOfTaps(1)
            .onEnd((_event: unknown, success?: boolean) => {
                'worklet';
                if (success === false) return;
                runOnJS(handleSingleTap)();
            });

        return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
    }, [active, box, content, handleSingleTap, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY, zoomed]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    return (
        <View testID={props.testID} style={{ flex: 1, overflow: 'hidden' }} onLayout={onLayout}>
            <GestureDetector
                gesture={gesture}
                {...(props.testID ? { testID: `${props.testID}-gesture` } as Record<string, string> : {})}
            >
                <Animated.View style={[{ flex: 1 }, animatedStyle]}>
                    {props.children}
                </Animated.View>
            </GestureDetector>
        </View>
    );
});
