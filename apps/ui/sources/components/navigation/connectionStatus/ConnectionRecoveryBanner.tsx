import * as React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';

import { StatusDot } from '@/components/ui/status/StatusDot';
import { Text } from '@/components/ui/text/Text';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { getStorage, useLocalSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { createConnectionRecoveryTracker, type ConnectionRecoveryPhase } from './connectionRecoveryTracker';

const FADE_MS = 180;

/**
 * A small pill at the top of the app while the server link recovers: "Reconnecting…" after a
 * drop that lasts, then "Reconnected" for a moment. It is a device setting. With the setting
 * off, nothing subscribes to the socket status.
 */
export function ConnectionRecoveryBanner(): React.ReactElement | null {
    const enabled = useLocalSetting('connectionRecoveryBannerEnabled') !== false;
    return enabled ? <ConnectionRecoveryBannerLive /> : null;
}

function ConnectionRecoveryBannerLive(): React.ReactElement | null {
    const socketStatus = getStorage()((state) => state.socketStatus);
    const [phase, setPhase] = React.useState<ConnectionRecoveryPhase>('hidden');
    const trackerRef = React.useRef<ReturnType<typeof createConnectionRecoveryTracker> | null>(null);

    React.useEffect(() => {
        const tracker = createConnectionRecoveryTracker(setPhase);
        trackerRef.current = tracker;
        return () => {
            tracker.dispose();
            trackerRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        trackerRef.current?.update(socketStatus);
    }, [socketStatus]);

    // Keep the last visible phase while the pill fades out.
    const [shownPhase, setShownPhase] = React.useState<Exclude<ConnectionRecoveryPhase, 'hidden'> | null>(null);
    const opacity = React.useRef(new Animated.Value(0)).current;
    const reducedMotion = useReducedMotionPreference();

    React.useEffect(() => {
        if (phase !== 'hidden') setShownPhase(phase);
        const animation = Animated.timing(opacity, {
            toValue: phase === 'hidden' ? 0 : 1,
            duration: reducedMotion ? 0 : FADE_MS,
            useNativeDriver: true,
        });
        animation.start(({ finished }) => {
            if (finished && phase === 'hidden') setShownPhase(null);
        });
        return () => animation.stop();
    }, [opacity, phase, reducedMotion]);

    if (shownPhase === null) return null;
    return <ConnectionRecoveryPill phase={shownPhase} opacity={opacity} />;
}

function ConnectionRecoveryPill(props: Readonly<{ phase: 'reconnecting' | 'reconnected'; opacity: Animated.Value }>) {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const reconnecting = props.phase === 'reconnecting';
    const label = reconnecting ? t('connectionStatus.recoveryBanner.reconnecting') : t('connectionStatus.recoveryBanner.reconnected');

    return (
        <View pointerEvents="none" style={[styles.host, { top: insets.top + 8 }]}>
            <Animated.View
                testID="connection-recovery-banner"
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[
                    styles.pill,
                    {
                        opacity: props.opacity,
                        backgroundColor: theme.colors.surface.elevated,
                        borderColor: theme.colors.border.default,
                    },
                ]}
            >
                <StatusDot
                    color={reconnecting ? theme.colors.status.connecting : theme.colors.status.connected}
                    isPulsing={reconnecting}
                    size={7}
                />
                <Text style={[styles.label, { color: theme.colors.text.primary }]}>{label}</Text>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    host: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
    },
    label: {
        fontSize: 13,
        fontWeight: '600',
    },
});
