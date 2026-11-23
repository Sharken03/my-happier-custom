import * as React from 'react';
import { Keyboard, Pressable, useWindowDimensions, View } from 'react-native';
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

import { OptionPickerOverlay, type OptionPickerOption } from './OptionPickerOverlay';
import { t } from '@/text';
import type { AgentInputSelectionOverlayState } from '@/components/sessions/agentInput/selection/agentInputSelectionOverlayTypes';

const OPEN_DURATION_MS = 260;
const SETTLE_DURATION_MS = 220;
const SETTLE_SPRING = { damping: 40, stiffness: 400, overshootClamping: true } as const;
const BACKDROP_OPACITY = 0.4;

function resolveModelPickerSheetSnap(translateY: number, velocityY: number, half: number, closed: number): number {
    if (velocityY < -500) return 0;
    if (velocityY > 500) return closed;
    if (translateY < half * 0.5) return 0;
    if (translateY > half * 1.5) return closed;
    return translateY < half ? 0 : half;
}

export type ModelPickerBottomSheetProps = Readonly<{
    onClosed: () => void;
    /** Model picker data from the overlay state */
    modelPickerData?: AgentInputSelectionOverlayState | null;
    /** Optional title shown in the sheet header */
    title?: string;
    /** Optional subtitle/description */
    subtitle?: string;
}>;

export function ModelPickerBottomSheet(props: ModelPickerBottomSheetProps) {
    const { onClosed, modelPickerData, title, subtitle } = props;
    const { height: windowHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const sheetHeight = Math.max(1, windowHeight - insets.top);
    const half = sheetHeight * 0.5;
    const closed = sheetHeight;

    const translateY = useSharedValue(closed);
    const closing = React.useRef(false);

    React.useEffect(() => {
        Keyboard.dismiss();
        translateY.value = withTiming(half, { duration: OPEN_DURATION_MS });
    }, []);

    const close = React.useCallback(() => {
        if (closing.current) return;
        closing.current = true;
        translateY.value = withTiming(closed, { duration: SETTLE_DURATION_MS }, (finished) => {
            if (finished) runOnJS(onClosed)();
        });
    }, [closed, onClosed, translateY]);

    const pan = React.useMemo(() => Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onStart(() => {})
        .onUpdate((event) => {
            translateY.value = Math.min(closed, Math.max(0, translateY.value + event.translationY));
        })
        .onEnd((event) => {
            const target = resolveModelPickerSheetSnap(translateY.value, event.velocityY, half, closed);
            if (target >= closed) {
                runOnJS(close)();
                return;
            }
            translateY.value = withSpring(target, { ...SETTLE_SPRING, velocity: event.velocityY });
        }), [close, closed, half, translateY]);

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
    const backdropStyle = useAnimatedStyle(() => ({
        opacity: BACKDROP_OPACITY * (1 - translateY.value / closed),
    }));

    const modelOptions = React.useMemo(() => {
        if (!modelPickerData || modelPickerData.id !== 'modelPicker') return [];
        return modelPickerData.modelOptions as OptionPickerOption[];
    }, [modelPickerData]);

    const selectedModelId = React.useMemo(() => {
        if (!modelPickerData || modelPickerData.id !== 'modelPicker') return '';
        return modelPickerData.selectedModelId;
    }, [modelPickerData]);

    const handleSelectModel = React.useCallback((value: string) => {
        if (!modelPickerData || modelPickerData.id !== 'modelPicker') return;
        modelPickerData.onSelectModel(value);
        close();
    }, [modelPickerData, close]);

    const handleClose = React.useCallback(() => {
        if (!modelPickerData || modelPickerData.id !== 'modelPicker') return;
        modelPickerData.onClose();
        close();
    }, [modelPickerData, close]);

    return (
        <View style={styles.root}>
            <Animated.View style={[styles.backdrop, backdropStyle]}>
                <Pressable testID="model-picker-sheet-backdrop" style={styles.fill} onPress={handleClose} />
            </Animated.View>
            <GestureDetector gesture={pan}>
                <Animated.View style={[styles.sheet, { height: sheetHeight }, sheetStyle]} testID="model-picker-sheet">
                    <View style={styles.grabber} />
                    {(title || subtitle) ? (
                        <View style={styles.header}>
                            {title ? <Text style={styles.headerTitle}>{title}</Text> : null}
                            {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
                        </View>
                    ) : null}
                    <OptionPickerOverlay
                        title={title ?? t('agentInput.model.title')}
                        options={modelOptions}
                        selectedValue={selectedModelId}
                        emptyText={t('agentInput.model.configureInCli')}
                        canEnterCustomValue={true}
                        customLabel={t('profiles.custom') + '...'}
                        customDescription={t('agentInput.model.customDescription')}
                        onSelect={handleSelectModel}
                        onSubmitCustomValue={handleSelectModel}
                    />
                </Animated.View>
            </GestureDetector>
        </View>
    );
}

import { Text } from '@/components/ui/text/Text';

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
    header: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.default,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
    headerSubtitle: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        marginTop: 2,
    },
}));