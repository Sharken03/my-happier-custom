import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';

const notificationAsync = vi.hoisted(() => vi.fn(() => Promise.resolve()));

// `expo-haptics` is the native haptic engine boundary; the bus, the store and the policy stay real.
vi.mock('expo-haptics', () => ({
    notificationAsync,
    selectionAsync: vi.fn(),
    impactAsync: vi.fn(),
    performAndroidHapticsAsync: vi.fn(),
    AndroidHaptics: {},
    ImpactFeedbackStyle: { Light: 'light' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import {
    notifyActivityAgentRequest,
    notifyActivityReady,
    resetActivityLocalNotificationRuntimeForTests,
} from './activityLocalNotificationBus';
import { subscribePermissionRequestHaptics } from './PermissionRequestHapticsRuntime';

function requestPermission(requestId: string, requestKind: 'permission' | 'user_action' = 'permission') {
    notifyActivityAgentRequest({ sessionId: 's1', requestId, requestKind, toolName: 'Bash', toolArgs: {} });
}

async function applyLocalSettings(settings: Record<string, boolean>) {
    const { getStorage } = await import('@/sync/domains/state/storageStore');
    getStorage().getState().applyLocalSettings(settings);
}

describe('permission request haptics', () => {
    let clock = 0;
    let unsubscribe: () => void = () => {};

    beforeEach(async () => {
        Reflect.set(Platform, 'OS', 'android');
        notificationAsync.mockClear();
        await applyLocalSettings({ hapticsEnabled: true, permissionRequestHapticsEnabled: true });
        clock = 10_000;
        unsubscribe = subscribePermissionRequestHaptics(() => clock);
    });

    afterEach(() => {
        unsubscribe();
        resetActivityLocalNotificationRuntimeForTests();
    });

    it('vibrates once when an agent asks for permission', () => {
        requestPermission('r1');
        expect(notificationAsync).toHaveBeenCalledTimes(1);
        expect(notificationAsync).toHaveBeenCalledWith('warning');
    });

    it('does not vibrate for turn ends or questions', () => {
        notifyActivityReady('s1');
        requestPermission('q1', 'user_action');
        expect(notificationAsync).not.toHaveBeenCalled();
    });

    it('vibrates once for a burst of requests and again for a later request', () => {
        requestPermission('r1');
        clock += 500;
        requestPermission('r2');
        expect(notificationAsync).toHaveBeenCalledTimes(1);
        clock += 5_000;
        requestPermission('r3');
        expect(notificationAsync).toHaveBeenCalledTimes(2);
    });

    it('stays silent when the permission vibration or all haptics are off', async () => {
        await applyLocalSettings({ permissionRequestHapticsEnabled: false });
        requestPermission('r1');
        await applyLocalSettings({ permissionRequestHapticsEnabled: true, hapticsEnabled: false });
        clock += 5_000;
        requestPermission('r2');
        expect(notificationAsync).not.toHaveBeenCalled();
        await applyLocalSettings({ hapticsEnabled: true });
    });
});
