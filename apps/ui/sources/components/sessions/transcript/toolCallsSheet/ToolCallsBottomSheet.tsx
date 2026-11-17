import * as React from 'react';
import { Keyboard, Pressable, useWindowDimensions, View, type FlatList, type ScrollView, type ScrollViewProps } from 'react-native';
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
    type AnimatedRef,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { NativeTextSelectionSuppressionScope } from '@/components/ui/text/nativeTextSelection';

import { resolveToolCallsSheetSnap } from './toolCallsSheetSnap';

const OPEN_DURATION_MS = 260;
const SETTLE_DURATION_MS = 220;
// The settle spring starts at the speed of the finger and does not overshoot the detent.
const SETTLE_SPRING = { damping: 40, stiffness: 400, overshootClamping: true } as const;
const BACKDROP_OPACITY = 0.4;
/** A flick in the list or a detail stops a little sooner than the Android default (0.985). */
export const TOOL_CALLS_SHEET_DECELERATION_RATE = 0.98;

type SheetScroll = Readonly<{
    listRef: AnimatedRef<FlatList>;
    detailRef: AnimatedRef<ScrollView>;
    onScroll: ReturnType<typeof useAnimatedScrollHandler>;
    /** True only while the sheet rests at full height. Below it, a swipe moves the sheet only. */
    scrollEnabled: boolean;
    nativeGesture: NativeGesture;
    /** Tells the sheet which scroll view shows now, so it can hold that one still. */
    setActiveScroll: (active: 'list' | 'detail') => void;
}>;

type SheetControls = Readonly<{
    /** Moves the sheet off screen, then calls `onClosed`. */
    close: () => void;
    scroll: SheetScroll;
}>;

const ToolCallsSheetControlsContext = React.createContext<SheetControls | null>(null);

export function useToolCallsSheetControls(): SheetControls {
    const controls = React.useContext(ToolCallsSheetControlsContext);
    if (!controls) throw new Error('useToolCallsSheetControls must be used inside ToolCallsBottomSheet');
    return controls;
}

/**
 * The scroll view of a call's detail in the sheet. A swipe on it moves the sheet when the sheet is
 * not at full height, or when the detail is at its top and the swipe goes down.
 */
export function ToolCallsSheetScrollView(props: ScrollViewProps) {
    const { scroll } = useToolCallsSheetControls();
    React.useEffect(() => {
        scroll.setActiveScroll('detail');
        return () => scroll.setActiveScroll('list');
    }, [scroll]);
    return (
        <GestureDetector gesture={scroll.nativeGesture}>
            <Animated.ScrollView
                {...props}
                ref={scroll.detailRef}
                onScroll={scroll.onScroll}
                scrollEventThrottle={16}
                scrollEnabled={scroll.scrollEnabled}
                decelerationRate={TOOL_CALLS_SHEET_DECELERATION_RATE}
                overScrollMode="never"
            />
        </GestureDetector>
    );
}

/**
 * The bottom sheet of the Tool calls route, drawn in JS so that a swipe anywhere on it moves it.
 * It opens at half height. A swipe up gives full height. At full height a list or detail scrolls
 * first; at its top a swipe down gives half height, and a second swipe down closes the sheet.
 * Below full height every swipe moves the sheet, and the content does not scroll. A long press
 * selects text at any height.
 */
export function ToolCallsBottomSheet(props: Readonly<{ onClosed: () => void; children: React.ReactNode }>) {
    const { onClosed } = props;
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
    const activeScroll = useSharedValue<'list' | 'detail'>('list');
    const sheetMoves = useSharedValue(false);
    const startY = useSharedValue(0);
    const startTranslation = useSharedValue(0);
    const previousTranslation = useSharedValue(0);
    const closing = React.useRef(false);
    // The content scrolls only while the sheet rests at full height.
    const [atFull, setAtFull] = React.useState(false);
    // Text is not selectable during a swipe, whether it scrolls the content or moves the sheet.
    // Else Android can start a selection mid-swipe, and the swipe cuts it off (the magnifier stays
    // on screen). A long press with a still finger starts no swipe, so it selects text.
    const [swiping, setSwiping] = React.useState(false);

    const listRef = useAnimatedRef<FlatList>();
    const detailRef = useAnimatedRef<ScrollView>();

    React.useEffect(() => {
        // An open keyboard would cover the sheet and take its swipes. Dismiss also blurs the
        // composer, so the next tap does not show the keyboard again.
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
                if (activeScroll.value === 'list') scrollTo(listRef, 0, lockedOffset.value, false);
                else scrollTo(detailRef, 0, lockedOffset.value, false);
                return;
            }
            scrollY.value = event.contentOffset.y;
        },
    });

    const nativeGesture = React.useMemo(() => Gesture.Native(), []);

    const setActiveScroll = React.useCallback((active: 'list' | 'detail') => {
        activeScroll.value = active;
        scrollY.value = 0;
    }, [activeScroll, scrollY]);

    const pan = React.useMemo(() => Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .simultaneousWithExternalGesture(nativeGesture)
        .onStart(() => {
            runOnJS(setSwiping)(true);
            sheetMoves.value = false;
            previousTranslation.value = 0;
        })
        .onUpdate((event) => {
            const delta = event.translationY - previousTranslation.value;
            previousTranslation.value = event.translationY;
            if (!sheetMoves.value) {
                // The sheet takes the swipe below full height, or at the top of the content on a
                // swipe down. Else the content scrolls.
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
            const target = resolveToolCallsSheetSnap(translateY.value, event.velocityY, half, closed);
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
            runOnJS(setSwiping)(false);
        }), [close, closed, half, lockedOffset, locked, nativeGesture, previousTranslation, scrollY, sheetMoves, startTranslation, startY, translateY]);

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
    const backdropStyle = useAnimatedStyle(() => ({
        opacity: BACKDROP_OPACITY * (1 - translateY.value / closed),
    }));

    const controls = React.useMemo<SheetControls>(() => ({
        close,
        scroll: { listRef, detailRef, onScroll, scrollEnabled: atFull, nativeGesture, setActiveScroll },
    }), [atFull, close, detailRef, listRef, nativeGesture, onScroll, setActiveScroll]);

    return (
        <View style={styles.root}>
            <Animated.View style={[styles.backdrop, backdropStyle]}>
                <Pressable testID="tool-calls-sheet-backdrop" style={styles.fill} onPress={close} />
            </Animated.View>
            <GestureDetector gesture={pan}>
                <Animated.View style={[styles.sheet, { height: sheetHeight }, sheetStyle]} testID="tool-calls-sheet">
                    <View style={styles.grabber} />
                    <ToolCallsSheetControlsContext.Provider value={controls}>
                        <NativeTextSelectionSuppressionScope suppressed={swiping}>
                            {props.children}
                        </NativeTextSelectionSuppressionScope>
                    </ToolCallsSheetControlsContext.Provider>
                </Animated.View>
            </GestureDetector>
        </View>
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
}));
