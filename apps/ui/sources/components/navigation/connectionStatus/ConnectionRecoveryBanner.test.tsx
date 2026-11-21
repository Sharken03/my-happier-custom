import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { CONNECTION_RECOVERY_SHOW_DELAY_MS } from './connectionRecoveryTracker';

vi.mock('react-native-safe-area-context', async () => {
    const { createSafeAreaContextMock } = await import('@/dev/testkit/mocks/nativeEnvironment');
    return createSafeAreaContextMock({
        keyboard: { isVisible: false, height: 0 },
        safeArea: { top: 20, right: 0, bottom: 0, left: 0 },
    });
});

async function store() {
    const { getStorage } = await import('@/sync/domains/state/storageStore');
    return getStorage();
}

async function setSocketStatus(status: 'connected' | 'disconnected') {
    const storage = await store();
    await React.act(async () => storage.setState({ socketStatus: status }));
}

const findBanner = (screen: Awaited<ReturnType<typeof renderScreen>>) =>
    screen.findAll((node: any) => node.props?.testID === 'connection-recovery-banner');

describe('ConnectionRecoveryBanner', () => {
    afterEach(async () => {
        standardCleanup();
        (await store()).getState().applyLocalSettings({ connectionRecoveryBannerEnabled: true });
    });

    it('shows reconnecting when a lost connection stays lost', async () => {
        await setSocketStatus('connected');
        const { ConnectionRecoveryBanner } = await import('./ConnectionRecoveryBanner');
        const screen = await renderScreen(<ConnectionRecoveryBanner />);
        expect(findBanner(screen)).toHaveLength(0);

        await setSocketStatus('disconnected');
        await React.act(() => new Promise((resolve) => setTimeout(resolve, CONNECTION_RECOVERY_SHOW_DELAY_MS + 100)));
        expect(findBanner(screen)).not.toHaveLength(0);
    });

    it('shows nothing when the setting is off', async () => {
        (await store()).getState().applyLocalSettings({ connectionRecoveryBannerEnabled: false });
        await setSocketStatus('connected');
        const { ConnectionRecoveryBanner } = await import('./ConnectionRecoveryBanner');
        const screen = await renderScreen(<ConnectionRecoveryBanner />);

        await setSocketStatus('disconnected');
        await React.act(() => new Promise((resolve) => setTimeout(resolve, CONNECTION_RECOVERY_SHOW_DELAY_MS + 100)));
        expect(findBanner(screen)).toHaveLength(0);
    });
});
