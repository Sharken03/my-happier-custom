import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';

import { notifyTranscriptContentRevealed } from '@/components/sessions/transcript/paint/transcriptContentRevealSignal';

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
        vi.useRealTimers();
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

    it('waits for the transcript to show its rows when the session has rows at open', async () => {
        const hook = await renderHook((props: { sessionId: string }) => useDeferredComposerAfterOpen(
            props.sessionId,
            true,
            { shouldWaitForTranscriptReveal: () => true },
        ), { initialProps: { sessionId: 'a' } });

        await runFrames(3);
        expect(hook.getCurrent()).toBe(false);

        await act(async () => notifyTranscriptContentRevealed('other-session'));
        await runFrames(1);
        expect(hook.getCurrent()).toBe(false);

        await act(async () => notifyTranscriptContentRevealed('a'));
        expect(hook.getCurrent()).toBe(false);
        await runFrames(1);
        expect(hook.getCurrent()).toBe(true);
    });

    it('releases one frame later when the transcript showed its rows in the commit that started the hold', async () => {
        const hook = await renderHook(() => {
            // Runs before the hold's own effect, like a transcript effect earlier in the same commit.
            React.useEffect(() => notifyTranscriptContentRevealed('a'), []);
            return useDeferredComposerAfterOpen('a', true, { shouldWaitForTranscriptReveal: () => true });
        });

        expect(hook.getCurrent()).toBe(false);
        await runFrames(1);
        expect(hook.getCurrent()).toBe(true);
    });

    it('does not count a reveal from an earlier open of the same session', async () => {
        notifyTranscriptContentRevealed('a');
        const hook = await renderHook(() => useDeferredComposerAfterOpen(
            'a',
            true,
            { shouldWaitForTranscriptReveal: () => true },
        ));

        await runFrames(3);
        expect(hook.getCurrent()).toBe(false);
    });

    it('releases the composer after the wait limit when the transcript never shows its rows', async () => {
        vi.useFakeTimers();
        const hook = await renderHook(() => useDeferredComposerAfterOpen(
            'a',
            true,
            { shouldWaitForTranscriptReveal: () => true, revealWaitMs: 1000 },
        ));

        await act(async () => { vi.advanceTimersByTime(999); });
        expect(hook.getCurrent()).toBe(false);
        await act(async () => { vi.advanceTimersByTime(1); });
        expect(hook.getCurrent()).toBe(true);
    });

    it('keeps the two-frame hold when the session has no rows to show, such as a new chat', async () => {
        const hook = await renderHook(() => useDeferredComposerAfterOpen(
            'a',
            true,
            { shouldWaitForTranscriptReveal: () => false },
        ));

        expect(hook.getCurrent()).toBe(false);
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
