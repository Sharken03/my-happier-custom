import * as React from 'react';

import { hapticsAttention } from '@/components/ui/theme/haptics';
import { readRegisteredStorageState } from '@/sync/domains/state/storageStateReaderBridge';

import { subscribeActivityLocalNotifications } from './activityLocalNotificationBus';

/** Requests that arrive within this time of a vibration share it. */
const BURST_WINDOW_MS = 2000;

/**
 * Vibrates when an agent asks for permission. It listens on the same bus as the local
 * notifications, which publishes each new request once. The device settings are read when a
 * request arrives, so the runtime holds no store subscription.
 */
export function subscribePermissionRequestHaptics(now: () => number = Date.now): () => void {
    let lastVibrationAt = Number.NEGATIVE_INFINITY;
    return subscribeActivityLocalNotifications((event) => {
        if (event.kind !== 'agent-request' || event.requestKind !== 'permission') return;
        if (readRegisteredStorageState()?.localSettings.permissionRequestHapticsEnabled === false) return;
        const at = now();
        if (at - lastVibrationAt < BURST_WINDOW_MS) return;
        lastVibrationAt = at;
        void hapticsAttention();
    });
}

export function PermissionRequestHapticsRuntime(): null {
    React.useEffect(() => subscribePermissionRequestHaptics(), []);
    return null;
}
