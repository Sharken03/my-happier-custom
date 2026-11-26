import * as React from 'react';
import { Platform, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import { StyleSheet } from 'react-native-unistyles';

import type { PickedAttachment } from '@/components/sessions/attachments/AttachmentFilePicker.types';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { useChromeSafeAreaInsets } from '@/components/ui/layout/useChromeSafeAreaInsets';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';

import { fitImageInBox, type ImageZoomSize } from '../imageZoomMath';
import { flattenMarkupImageOnNative, flattenMarkupImageOnWeb } from './flattenMarkupImage';
import {
    MARKUP_COLORS,
    MARKUP_STROKE_WIDTH,
    appendMarkupPoint,
    markupStrokeToSvgPath,
    toMarkupPoint,
    type MarkupPoint,
    type MarkupStroke,
} from './markupStrokes';

// The viewer is always dark, like a photo viewer, whatever the app theme is.
const VIEWER_FOREGROUND = '#ffffff';

const styles = StyleSheet.create(() => ({
    root: {
        flex: 1,
        backgroundColor: '#000000',
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 8,
    },
    topBarGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    textButton: {
        minHeight: 40,
        paddingHorizontal: 16,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(40, 40, 40, 0.9)',
    },
    textButtonLabel: {
        color: VIEWER_FOREGROUND,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    roundButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(40, 40, 40, 0.9)',
    },
    disabled: {
        opacity: 0.4,
    },
    stage: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    canvas: {
        position: 'relative',
        overflow: 'hidden',
    },
    fill: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    palette: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 14,
        paddingVertical: 14,
    },
    swatch: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.35)',
    },
    swatchSelected: {
        borderColor: VIEWER_FOREGROUND,
        transform: [{ scale: 1.15 }],
    },
}));

type ImageMarkupEditorProps = Readonly<{
    uri: string;
    fileName: string;
    onCancel: () => void;
    /** Receives the flattened image as a picked attachment, ready for the composer draft. */
    onDone: (attachment: PickedAttachment) => void;
}>;

/**
 * Freehand markup on top of an image: pen, a few colors, undo, cancel and done.
 * Done draws the strokes onto the image (canvas on web, view capture on native).
 */
export const ImageMarkupEditor = React.memo(function ImageMarkupEditor(props: ImageMarkupEditorProps) {
    const insets = useChromeSafeAreaInsets();
    const [stage, setStage] = React.useState<ImageZoomSize>({ width: 0, height: 0 });
    const [imageSize, setImageSize] = React.useState<ImageZoomSize | null>(null);
    const [color, setColor] = React.useState<string>(MARKUP_COLORS[0] ?? '#ff3b30');
    const [strokes, setStrokes] = React.useState<ReadonlyArray<MarkupStroke>>([]);
    const [activePoints, setActivePoints] = React.useState<ReadonlyArray<MarkupPoint> | null>(null);
    const [busy, setBusy] = React.useState(false);
    const canvasRef = React.useRef<View | null>(null);
    const activePointsRef = React.useRef<ReadonlyArray<MarkupPoint> | null>(null);

    const canvasSize = React.useMemo(() => fitImageInBox(stage, imageSize), [imageSize, stage]);
    const canvasSizeRef = React.useRef(canvasSize);
    canvasSizeRef.current = canvasSize;
    const colorRef = React.useRef(color);
    colorRef.current = color;

    const onStageLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setStage((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    }, []);

    const onImageLoad = React.useCallback((event: { source?: { width?: number; height?: number } }) => {
        const width = event.source?.width ?? 0;
        const height = event.source?.height ?? 0;
        if (width > 0 && height > 0) setImageSize({ width, height });
    }, []);

    const setActive = React.useCallback((points: ReadonlyArray<MarkupPoint> | null) => {
        activePointsRef.current = points;
        setActivePoints(points);
    }, []);

    const gesture = React.useMemo(() => Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .maxPointers(1)
        .onBegin((event: { x: number; y: number }) => {
            setActive([toMarkupPoint(event.x, event.y, canvasSizeRef.current)]);
        })
        .onUpdate((event: { x: number; y: number }) => {
            const current = activePointsRef.current;
            if (!current) return;
            const next = appendMarkupPoint(current, toMarkupPoint(event.x, event.y, canvasSizeRef.current));
            if (next !== current) setActive(next);
        })
        .onEnd(() => {
            const points = activePointsRef.current;
            if (points && points.length > 0) {
                const stroke: MarkupStroke = { color: colorRef.current, width: MARKUP_STROKE_WIDTH, points };
                setStrokes((prev) => [...prev, stroke]);
            }
            setActive(null);
        })
        .onFinalize(() => {
            if (activePointsRef.current) setActive(null);
        }), [setActive]);

    const undo = React.useCallback(() => {
        setStrokes((prev) => prev.slice(0, -1));
    }, []);

    const { uri, fileName, onDone } = props;
    const done = React.useCallback(async () => {
        if (busy || strokes.length === 0) return;
        setBusy(true);
        try {
            const attachment = Platform.OS === 'web'
                ? await flattenMarkupImageOnWeb({ sourceUri: uri, strokes, fileName })
                : await flattenMarkupImageOnNative({ captureTarget: canvasRef, imageSize, fileName });
            onDone(attachment);
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : t('errors.operationFailed'));
        } finally {
            setBusy(false);
        }
    }, [busy, fileName, imageSize, onDone, strokes, uri]);

    const drawnStrokes = activePoints
        ? [...strokes, { color, width: MARKUP_STROKE_WIDTH, points: activePoints }]
        : strokes;
    const canUndo = strokes.length > 0 && !busy;
    const canFinish = strokes.length > 0 && !busy;

    return (
        <View style={styles.root} testID="image-markup-editor">
            <View style={[styles.topBar, { paddingTop: insets.top + 8, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
                <Pressable
                    testID="image-markup-cancel"
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                    onPress={props.onCancel}
                    disabled={busy}
                    style={[styles.textButton, busy ? styles.disabled : null]}
                >
                    <Text style={styles.textButtonLabel}>{t('common.cancel')}</Text>
                </Pressable>
                <View style={styles.topBarGroup}>
                    <Pressable
                        testID="image-markup-undo"
                        accessibilityRole="button"
                        accessibilityLabel={t('files.imageViewer.undo')}
                        onPress={undo}
                        disabled={!canUndo}
                        style={[styles.roundButton, !canUndo ? styles.disabled : null]}
                    >
                        <Icon name="arrow-arc-left" size={20} color={VIEWER_FOREGROUND} />
                    </Pressable>
                    <Pressable
                        testID="image-markup-done"
                        accessibilityRole="button"
                        accessibilityLabel={t('common.done')}
                        onPress={() => { void done(); }}
                        disabled={!canFinish}
                        style={[styles.textButton, !canFinish ? styles.disabled : null]}
                    >
                        {busy
                            ? <ActivitySpinner size="small" color={VIEWER_FOREGROUND} />
                            : <Text style={styles.textButtonLabel}>{t('common.done')}</Text>}
                    </Pressable>
                </View>
            </View>

            <View style={styles.stage} testID="image-markup-stage" onLayout={onStageLayout}>
                <GestureDetector
                    gesture={gesture}
                    {...({ testID: 'image-markup-canvas-gesture' } as Record<string, string>)}
                >
                    <View
                        ref={canvasRef}
                        collapsable={false}
                        testID="image-markup-canvas"
                        style={[styles.canvas, { width: canvasSize.width, height: canvasSize.height }]}
                    >
                        <Image
                            source={{ uri: props.uri }}
                            style={styles.fill}
                            contentFit="fill"
                            onLoad={onImageLoad}
                        />
                        <Svg width={canvasSize.width} height={canvasSize.height} style={styles.fill} pointerEvents="none">
                            {drawnStrokes.map((stroke, index) => (
                                <Path
                                    key={index}
                                    d={markupStrokeToSvgPath(stroke, canvasSize.width, canvasSize.height)}
                                    stroke={stroke.color}
                                    strokeWidth={stroke.width * canvasSize.width}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    fill="none"
                                />
                            ))}
                        </Svg>
                    </View>
                </GestureDetector>
            </View>

            <View style={[styles.palette, { paddingBottom: insets.bottom + 14 }]}>
                {MARKUP_COLORS.map((swatch) => (
                    <Pressable
                        key={swatch}
                        testID={`image-markup-color-${swatch}`}
                        accessibilityRole="button"
                        accessibilityLabel={t('files.imageViewer.penColor')}
                        accessibilityState={{ selected: swatch === color }}
                        hitSlop={6}
                        onPress={() => setColor(swatch)}
                        style={[styles.swatch, { backgroundColor: swatch }, swatch === color ? styles.swatchSelected : null]}
                    />
                ))}
            </View>
        </View>
    );
});
