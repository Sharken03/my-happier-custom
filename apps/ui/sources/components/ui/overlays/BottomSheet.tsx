import * as React from 'react';
import { Keyboard, Modal, Pressable, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

const OPEN_DURATION_MS = 260;
const SETTLE_DURATION_MS = 220;
// The settle spring starts at the speed of the finger and does not overshoot the detent.
const SETTLE_SPRING = { damping: 40, stiffness: 400, overshootClamping: true } as const;
const BACKDROP_OPACITY = 0.4;

type SheetDetent = Readonly<{ height: number; top: number }>;

function resolveSheetSnap(translateY: number, velocityY: number, half: number, closed: number): number {
    if (velocityY < -500) return 0;
    if (velocityY > 500) return closed;
    if (translateY < half * 0.5) return 0;
    if (translateY > half * 1.5) return closed;
    return translateY < half ? 0 : half;
}

export type BottomSheetProps = Readonly<{
    onRequestClose: () => void;
    /** Receives the sheet's inner height, so the content can cap its own scroll area. */
    children: (detent: SheetDetent) => React.ReactNode;
    testID?: string;
}>;

/**
 * A bottom sheet drawn in JS, in its own full-screen window, so it opens over the whole screen
 * rather than inside the composer it was opened from, and the screen behind it stays untouchable.
 *
 * It opens at half height with a grabber and a dimmed backdrop. A swipe up gives full height; a
 * swipe down from half height closes it, and so does a tap on the backdrop. The content decides
 * its own scrolling; the sheet only moves while it is below full height.
 */
export function BottomSheet(props: BottomSheetProps) {
    const { onRequestClose, children, testID } = props;
    const { height: windowHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const sheetHeight = Math.max(1, windowHeight - insets.top);
    const half = sheetHeight * 0.5;
    const closed = sheetHeight;

    // How far the sheet is moved down from full height.
    const translateY = useSharedValue(closed);
    // True while the sheet rests at full height; only then may the content scroll.
    const [atFull, setAtFull] = React.useState(false);
    const sheetMoves = useSharedValue(false);
    const startY = useSharedValue(0);
    const startTranslation = useSharedValue(0);
    const previousTranslation = useSharedValue(0);
    const closing = React.useRef(false);

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
            if (finished) runOnJS(onRequestClose)();
        });
    }, [closed, onRequestClose, translateY]);

    const pan = React.useMemo(() => Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onStart(() => {
            sheetMoves.value = false;
            previousTranslation.value = 0;
        })
        .onUpdate((event) => {
            const delta = event.translationY - previousTranslation.value;
            previousTranslation.value = event.translationY;
            if (!sheetMoves.value) {
                // Below full height every swipe moves the sheet; at full height only a swipe down
                // pulls it back, so the content keeps its own drags.
                if (translateY.value <= 0.5 && delta < 0) return;
                sheetMoves.value = true;
                runOnJS(setAtFull)(false);
                startY.value = translateY.value;
                startTranslation.value = event.translationY - delta;
            }
            translateY.value = Math.min(closed, Math.max(0, startY.value + event.translationY - startTranslation.value));
        })
        .onEnd((event) => {
            if (!sheetMoves.value) return;
            sheetMoves.value = false;
            const target = resolveSheetSnap(translateY.value, event.velocityY, half, closed);
            if (target >= closed) {
                runOnJS(close)();
                return;
            }
            translateY.value = withSpring(target, { ...SETTLE_SPRING, velocity: event.velocityY }, (finished) => {
                if (finished) runOnJS(setAtFull)(target <= 0);
            });
        })
        .onFinalize(() => {
            sheetMoves.value = false;
        }), [
            close,
            closed,
            half,
            previousTranslation,
            sheetMoves,
            startTranslation,
            startY,
            translateY,
        ]);

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
    const backdropStyle = useAnimatedStyle(() => ({
        opacity: BACKDROP_OPACITY * (1 - translateY.value / closed),
    }));

    const detent = React.useMemo<SheetDetent>(
        () => ({ height: Math.max(1, sheetHeight - insets.bottom), top: insets.top }),
        [insets.bottom, insets.top, sheetHeight],
    );

    return (
        <Modal
            visible
            transparent
            animationType="none"
            statusBarTranslucent
            onRequestClose={close}
        >
            <View style={styles.root} testID={testID}>
                <Animated.View style={[styles.backdrop, backdropStyle]}>
                    <Pressable testID="bottom-sheet-backdrop" style={styles.fill} onPress={close} />
                </Animated.View>
                <GestureDetector gesture={pan}>
                    <Animated.View style={[styles.sheet, { height: sheetHeight }, sheetStyle]}>
                        <View style={styles.grabber} />
                        <View style={[styles.content, { paddingBottom: insets.bottom }]}>
                            {children(detent)}
                        </View>
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
        flex: 1,
        minHeight: 0,
    },
}));
