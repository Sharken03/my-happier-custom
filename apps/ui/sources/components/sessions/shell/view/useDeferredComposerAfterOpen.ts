import * as React from 'react';

/**
 * Holds the composer back for the first frames after a session opens.
 *
 * Opening a session renders the shell, the transcript and the composer in one synchronous commit.
 * The composer subtree is a large part of that commit, so the transcript paints later. With this
 * hook the first commit has the transcript and a placeholder of the last composer height; the
 * composer renders two frames later. Returns true when the composer can render.
 */
export function useDeferredComposerAfterOpen(sessionId: string, enabled: boolean): boolean {
    const [readySessionId, setReadySessionId] = React.useState<string | null>(null);
    // Without a frame loop (for example in a test renderer) there is no later frame to wait for.
    const canDefer = enabled && typeof requestAnimationFrame === 'function';
    const ready = !canDefer || readySessionId === sessionId;

    React.useEffect(() => {
        if (ready) return;
        let secondFrame: number | null = null;
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                secondFrame = null;
                setReadySessionId(sessionId);
            });
        });
        return () => {
            cancelAnimationFrame(firstFrame);
            if (secondFrame !== null) cancelAnimationFrame(secondFrame);
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
