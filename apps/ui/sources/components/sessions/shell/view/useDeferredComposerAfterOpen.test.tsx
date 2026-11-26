import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';

import {
    readRememberedComposerHeight,
    rememberComposerHeight,
    useDeferredComposerAfterOpen,
} from './useDeferredComposerAfterOpen';

describe('useDeferredComposerAfterOpen', () => {
    let frames: Array<() => void> = [];

    beforeEach(() => {
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
            frames.push(callback);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', () => {});
    });

    afterEach(() => {
        standardCleanup();
        vi.unstubAllGlobals();
    });

    async function runFrames(count: number) {
        for (let index = 0; index < count; index += 1) {
            const pending = frames;
            frames = [];
            await act(async () => {
                for (const callback of pending) callback();
            });
        }
    }

    it('holds the composer back for the first frames of an open, then releases it', async () => {
        const seen: boolean[] = [];
        const hook = await renderHook((props: { sessionId: string }) => {
            const ready = useDeferredComposerAfterOpen(props.sessionId, true);
            seen.push(ready);
            return ready;
        }, { initialProps: { sessionId: 'a' } });

        expect(seen[0]).toBe(false);
        expect(hook.getCurrent()).toBe(false);
        await runFrames(2);
        expect(hook.getCurrent()).toBe(true);

        await hook.rerender({ sessionId: 'b' });
        expect(seen).toContain(false);
        expect(seen[seen.length - 1]).toBe(false);
        await runFrames(2);
        expect(hook.getCurrent()).toBe(true);
    });

    it('renders the composer at once when the setting is off', async () => {
        const seen: boolean[] = [];
        await renderHook(() => {
            const ready = useDeferredComposerAfterOpen('a', false);
            seen.push(ready);
            return ready;
        });
        expect(seen.every(Boolean)).toBe(true);
    });

    it('renders the composer at once when there is no frame loop', async () => {
        vi.stubGlobal('requestAnimationFrame', undefined);
        const seen: boolean[] = [];
        await renderHook(() => {
            const ready = useDeferredComposerAfterOpen('a', true);
            seen.push(ready);
            return ready;
        });
        expect(seen.every(Boolean)).toBe(true);
    });

    it('remembers the last measured composer height', () => {
        rememberComposerHeight(0);
        rememberComposerHeight(Number.NaN);
        rememberComposerHeight(132.6);
        expect(readRememberedComposerHeight()).toBe(133);
    });
});
