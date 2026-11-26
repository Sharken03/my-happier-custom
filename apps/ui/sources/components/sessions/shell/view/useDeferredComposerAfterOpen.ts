import * as React from 'react';

import {
    readTranscriptContentRevealMark,
    subscribeTranscriptContentRevealed,
    wasTranscriptContentRevealedSince,
} from '@/components/sessions/transcript/paint/transcriptContentRevealSignal';

/**
 * The longest time the composer waits for the transcript. Measured on a phone, a warm transcript
 * shows its rows about 0.9 s after the tap; a transcript that must load first takes longer, and
 * the composer must not wait for that load.
 */
export const DEFERRED_COMPOSER_REVEAL_WAIT_MS = 1200;

export type DeferredComposerOptions = Readonly<{
    /**
     * Read when the hold starts. True when the transcript has rows to show, so the composer waits
     * until the transcript shows them. False keeps the two-frame hold (for example a new chat,
     * where the reader wants to type at once).
     */
    shouldWaitForTranscriptReveal?: (sessionId: string) => boolean;
    revealWaitMs?: number;
}>;

/**
 * Holds the composer back while a session opens.
 *
 * Opening a session renders the shell, the transcript and the composer. The composer subtree is a
 * large part of that work. On native the transcript stays covered until its rows are placed, which
 * takes longer than two frames; a composer that renders in that time delays the transcript. So when
 * the transcript has rows to show, the composer waits until the transcript shows them (or until
 * revealWaitMs), and then one frame more. Otherwise it waits two frames. Returns true when the
 * composer can render.
 */
export function useDeferredComposerAfterOpen(
    sessionId: string,
    enabled: boolean,
    options: DeferredComposerOptions = {},
): boolean {
    const [readySessionId, setReadySessionId] = React.useState<string | null>(null);
    // Without a frame loop (for example in a test renderer) there is no later frame to wait for.
    const canDefer = enabled && typeof requestAnimationFrame === 'function';
    const ready = !canDefer || readySessionId === sessionId;
    const optionsRef = React.useRef(options);
    optionsRef.current = options;
    // Read during the render that starts the hold: a transcript effect in the same commit can
    // show the rows before this hook's effect subscribes.
    const holdMarkRef = React.useRef<Readonly<{ sessionId: string; mark: number }> | null>(null);
    if (!ready && holdMarkRef.current?.sessionId !== sessionId) {
        holdMarkRef.current = { sessionId, mark: readTranscriptContentRevealMark() };
    }

    React.useEffect(() => {
        if (ready) return;
        let released = false;
        const frames = new Set<number>();
        let waitTimer: ReturnType<typeof setTimeout> | null = null;
        let unsubscribe: (() => void) | null = null;
        const release = () => {
            if (released) return;
            released = true;
            setReadySessionId(sessionId);
        };
        const releaseAfterFrame = () => {
            if (released) return;
            frames.add(requestAnimationFrame(release));
        };

        const { shouldWaitForTranscriptReveal, revealWaitMs = DEFERRED_COMPOSER_REVEAL_WAIT_MS } = optionsRef.current;
        const holdMark = holdMarkRef.current?.sessionId === sessionId
            ? holdMarkRef.current.mark
            : readTranscriptContentRevealMark();
        if (shouldWaitForTranscriptReveal?.(sessionId) !== true) {
            frames.add(requestAnimationFrame(releaseAfterFrame));
        } else if (wasTranscriptContentRevealedSince(sessionId, holdMark)) {
            releaseAfterFrame();
        } else {
            unsubscribe = subscribeTranscriptContentRevealed((revealedSessionId) => {
                if (revealedSessionId === sessionId) releaseAfterFrame();
            });
            waitTimer = setTimeout(release, revealWaitMs);
        }

        return () => {
            released = true;
            for (const frame of frames) cancelAnimationFrame(frame);
            if (waitTimer !== null) clearTimeout(waitTimer);
            unsubscribe?.();
        };
    }, [ready, sessionId]);

    return ready;
}

let rememberedComposerHeight = 0;

/** Stores the measured composer height, so the placeholder on the next open has the same height. */
export function rememberComposerHeight(height: number): void {
    if (!Number.isFinite(height) || height <= 0) return;
    rememberedComposerHeight = Math.round(height);
}

export function readRememberedComposerHeight(): number {
    return rememberedComposerHeight;
}
