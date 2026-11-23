import * as React from 'react';
import { Keyboard, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    scrollTo,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import type { AgentInputModelPickerOverlayData } from '@/components/sessions/agentInput/selection/agentInputSelectionOverlayTypes';
import { useSetting } from '@/sync/store/hooks';
import { t } from '@/text';

import { OptionPickerOverlay } from './OptionPickerOverlay';

const OPEN_DURATION_MS = 260;
const SETTLE_DURATION_MS = 220;
// The settle spring starts at the speed of the finger and does not overshoot the detent.
const SETTLE_SPRING = { damping: 40, stiffness: 400, overshootClamping: true } as const;
const BACKDROP_OPACITY = 0.4;
const SHEET_DECELERATION_RATE = 0.98;

function resolveModelPickerSheetSnap(translateY: number, velocityY: number, half: number, closed: number): number {
    if (velocityY < -500) return 0;
    if (velocityY > 500) return closed;
    if (translateY < half * 0.5) return 0;
    if (translateY > half * 1.5) return closed;
    return translateY < half ? 0 : half;
}

/**
 * The model picker, drawn in JS as the same kind of bottom sheet as the Tool calls route: it opens
 * at half height with a grabber and a backdrop. A swipe up gives full height, a swipe down from
 * half height closes it. The list scrolls only while the sheet rests at full height; below that a
 * swipe moves the sheet, so a swipe never moves a sheet the user is not holding.
 */
export function ModelPickerBottomSheet(props: Readonly<{
    modelPickerData: AgentInputModelPickerOverlayData;
    onClosed: () => void;
}>) {
    const { modelPickerData, onClosed } = props;
    const presentation = useSetting('agentInputModelPickerLayout');
    const { height: windowHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const sheetHeight = Math.max(1, windowHeight - insets.top);
    const half = sheetHeight * 0.5;
    const closed = sheetHeight;

    // How far the sheet is moved down from full height.
    const translateY = useSharedValue(closed);
    const scrollY = useSharedValue(0);
    // While the sheet moves, the scroll view is held at `lockedOffset`.
    const locked = useSharedValue(false);
    const lockedOffset = useSharedValue(0);
    const sheetMoves = useSharedValue(false);
    const startY = useSharedValue(0);
    const startTranslation = useSharedValue(0);
    const previousTranslation = useSharedValue(0);
    const closing = React.useRef(false);
    // The content scrolls only while the sheet rests at full height.
    const [atFull, setAtFull] = React.useState(false);
    const scrollRef = useAnimatedRef<ScrollView>();

    React.useEffect(() => {
        // An open keyboard would cover the sheet and take its swipes.
        Keyboard.dismiss();
        translateY.value = withTiming(half, { duration: OPEN_DURATION_MS });
        // Opens once; a size change keeps the position the user chose.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const close = React.useCallback(() => {
        if (closing.current) return;
        closing.current = true;
        translateY.value = withTiming(closed, { duration: SETTLE_DURATION_MS }, (finished) => {
            if (finished) runOnJS(onClosed)();
        });
    }, [closed, onClosed, translateY]);

    const onScroll = useAnimatedScrollHandler({
        onScroll: (event) => {
            if (locked.value) {
                scrollTo(scrollRef, 0, lockedOffset.value, false);
                return;
            }
            scrollY.value = event.contentOffset.y;
        },
    });

    const nativeGesture = React.useMemo(() => Gesture.Native(), []);

    const pan = React.useMemo(() => Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .simultaneousWithExternalGesture(nativeGesture)
        .onStart(() => {
            sheetMoves.value = false;
            previousTranslation.value = 0;
        })
        .onUpdate((event) => {
            const delta = event.translationY - previousTranslation.value;
            previousTranslation.value = event.translationY;
            if (!sheetMoves.value) {
                // The sheet takes the swipe below full height, or at the top of the list on a swipe
                // down. Else the list scrolls.
                const takes = translateY.value > 0.5 || (scrollY.value <= 0 && delta > 0);
                if (!takes) return;
                sheetMoves.value = true;
                runOnJS(setAtFull)(false);
                startY.value = translateY.value;
                startTranslation.value = event.translationY - delta;
                lockedOffset.value = Math.max(0, scrollY.value);
                locked.value = true;
            }
            translateY.value = Math.min(closed, Math.max(0, startY.value + event.translationY - startTranslation.value));
        })
        .onEnd((event) => {
            locked.value = false;
            if (!sheetMoves.value) return;
            sheetMoves.value = false;
            const target = resolveModelPickerSheetSnap(translateY.value, event.velocityY, half, closed);
            if (target >= closed) {
                runOnJS(close)();
                return;
            }
            translateY.value = withSpring(target, { ...SETTLE_SPRING, velocity: event.velocityY }, (finished) => {
                if (finished) runOnJS(setAtFull)(target <= 0);
            });
        })
        .onFinalize(() => {
            locked.value = false;
            sheetMoves.value = false;
        }), [
            close,
            closed,
            half,
            locked,
            lockedOffset,
            nativeGesture,
            previousTranslation,
            scrollY,
            sheetMoves,
            startTranslation,
            startY,
            translateY,
        ]);

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
    const backdropStyle = useAnimatedStyle(() => ({
        opacity: BACKDROP_OPACITY * (1 - translateY.value / closed),
    }));

    const handleSelect = React.useCallback((value: string) => {
        modelPickerData.onSelectModel(value);
        close();
    }, [close, modelPickerData]);

    return (
        <Modal
            visible
            transparent
            animationType="none"
            statusBarTranslucent
            onRequestClose={close}
        >
        <View style={styles.root}>
            <Animated.View style={[styles.backdrop, backdropStyle]}>
                <Pressable testID="model-picker-sheet-backdrop" style={styles.fill} onPress={close} />
            </Animated.View>
            <GestureDetector gesture={pan}>
                <Animated.View style={[styles.sheet, { height: sheetHeight }, sheetStyle]} testID="model-picker-sheet">
                    <View style={styles.grabber} />
                    <GestureDetector gesture={nativeGesture}>
                        <Animated.ScrollView
                            ref={scrollRef}
                            onScroll={onScroll}
                            scrollEventThrottle={16}
                            scrollEnabled={atFull}
                            decelerationRate={SHEET_DECELERATION_RATE}
                            overScrollMode="never"
                            contentContainerStyle={styles.content}
                            keyboardShouldPersistTaps="handled"
                        >
                            <OptionPickerOverlay
                                title={t('agentInput.model.title')}
                                options={modelPickerData.modelOptions}
                                selectedValue={modelPickerData.selectedModelId}
                                emptyText={t('agentInput.model.configureInCli')}
                                canEnterCustomValue={false}
                                presentation={presentation}
                                onSelect={handleSelect}
                            />
                        </Animated.ScrollView>
                    </GestureDetector>
                </Animated.View>
            </GestureDetector>
        </View>
        </Modal>
    );
}

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
    },
    fill: {
        flex: 1,
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: '#000',
    },
    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        backgroundColor: theme.colors.surface.base,
    },
    grabber: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        marginTop: 8,
        backgroundColor: theme.colors.border.default,
    },
    content: {
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 24,
    },
}));
