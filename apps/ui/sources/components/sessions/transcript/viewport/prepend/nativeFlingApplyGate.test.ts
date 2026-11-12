import { describe, expect, it } from 'vitest';

import { createNativeFlingApplyGate } from './nativeFlingApplyGate';

function trackSettled(promise: Promise<void>): { settled: () => boolean } {
    let settled = false;
    void promise.then(() => { settled = true; });
    return { settled: () => settled };
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('createNativeFlingApplyGate', () => {
    it('lets a page in at once when no fling runs', async () => {
        const gate = createNativeFlingApplyGate({ platformOS: 'android', readFling: () => ({ momentumActive: false, dragActive: false }) });
        const wait = trackSettled(gate.waitForApply());
        await flush();
        expect(wait.settled()).toBe(true);
    });

    it('holds a page during an Android fling and lets it in when the fling ends', async () => {
        const fling = { momentumActive: true, dragActive: false };
        const gate = createNativeFlingApplyGate({ platformOS: 'android', readFling: () => fling });
        const wait = trackSettled(gate.waitForApply());
        gate.notify();
        await flush();
        expect(wait.settled()).toBe(false);

        fling.momentumActive = false;
        gate.notify();
        await flush();
        expect(wait.settled()).toBe(true);
    });

    it('lets a held page in when a drag stops the fling', async () => {
        const fling = { momentumActive: true, dragActive: false };
        const gate = createNativeFlingApplyGate({ platformOS: 'android', readFling: () => fling });
        const wait = trackSettled(gate.waitForApply());

        fling.dragActive = true;
        gate.notify();
        await flush();
        expect(wait.settled()).toBe(true);
    });

    it('releases held pages when the transcript lets go of the gate', async () => {
        const gate = createNativeFlingApplyGate({ platformOS: 'android', readFling: () => ({ momentumActive: true, dragActive: false }) });
        const wait = trackSettled(gate.waitForApply());
        gate.releaseAll();
        await flush();
        expect(wait.settled()).toBe(true);
    });

    it.each(['ios', 'web'] as const)('does not hold pages on %s', async (platformOS) => {
        const gate = createNativeFlingApplyGate({ platformOS, readFling: () => ({ momentumActive: true, dragActive: false }) });
        const wait = trackSettled(gate.waitForApply());
        await flush();
        expect(wait.settled()).toBe(true);
    });
});
