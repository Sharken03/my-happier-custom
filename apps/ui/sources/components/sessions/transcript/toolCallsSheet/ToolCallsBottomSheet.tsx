import * as React from 'react';
import { Pressable, useWindowDimensions, View, type FlatList, type ScrollView, type ScrollViewProps } from 'react-native';
import { Gesture, GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    scrollTo,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type AnimatedRef,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { resolveToolCallsSheetSnap } from './toolCallsSheetSnap';

const OPEN_DURATION_MS = 260;
const SETTLE_DURATION_MS = 220;
const BACKDROP_OPACITY = 0.4;

type SheetScroll = Readonly<{
    listRef: AnimatedRef<FlatList>;
    detailRef: AnimatedRef<ScrollView>;
    onScroll: ReturnType<typeof useAnimatedScrollHandler>;
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
                overScrollMode="never"
            />
        </GestureDetector>
    );
}

/**
 * The bottom sheet of the Tool calls route, drawn in JS so that a swipe anywhere on it moves it.
 * It opens at half height. A swipe up gives full height. At full height a list or detail scrolls
 * first; at its top a swipe down gives half height, and a second swipe down closes the sheet.
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

    const listRef = useAnimatedRef<FlatList>();
    const detailRef = useAnimatedRef<ScrollView>();

    React.useEffect(() => {
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
                startY.value = translateY.value;
                startTranslation.value = event.translationY - delta;
                lockedOffset.value = Math.max(0, scrollY.value);
                locked.value = true;
            }
            const next = Math.min(closed, Math.max(0, startY.value + event.translationY - startTranslation.value));
            translateY.value = next;
            if (next <= 0 && delta < 0) {
                // Full height and the finger goes up: the content scrolls again.
                sheetMoves.value = false;
                locked.value = false;
            }
        })
        .onEnd((event) => {
            locked.value = false;
            if (!sheetMoves.value) return;
            sheetMoves.value = false;
            const target = resolveToolCallsSheetSnap(translateY.value, event.velocityY, half, closed);
            translateY.value = withTiming(target, { duration: SETTLE_DURATION_MS }, (finished) => {
                if (finished && target >= closed) runOnJS(close)();
            });
        })
        .onFinalize(() => {
            locked.value = false;
        }), [close, closed, half, lockedOffset, locked, nativeGesture, previousTranslation, scrollY, sheetMoves, startTranslation, startY, translateY]);

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
    const backdropStyle = useAnimatedStyle(() => ({
        opacity: BACKDROP_OPACITY * (1 - translateY.value / closed),
    }));

    const controls = React.useMemo<SheetControls>(() => ({
        close,
        scroll: { listRef, detailRef, onScroll, nativeGesture, setActiveScroll },
    }), [close, detailRef, listRef, nativeGesture, onScroll, setActiveScroll]);

    return (
        <View style={styles.root}>
            <Animated.View style={[styles.backdrop, backdropStyle]}>
                <Pressable testID="tool-calls-sheet-backdrop" style={styles.fill} onPress={close} />
            </Animated.View>
            <GestureDetector gesture={pan}>
                <Animated.View style={[styles.sheet, { height: sheetHeight }, sheetStyle]} testID="tool-calls-sheet">
                    <View style={styles.grabber} />
                    <ToolCallsSheetControlsContext.Provider value={controls}>
                        {props.children}
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
