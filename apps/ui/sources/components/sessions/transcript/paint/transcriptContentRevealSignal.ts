/**
 * Tells the rest of the session screen when a transcript showed its rows for the first time.
 *
 * The transcript stays covered until its rows are painted and placed. Work that does not have to
 * be in that frame (the composer, see useDeferredComposerAfterOpen) waits for this signal, so it
 * does not hold the JavaScript thread while the transcript gets ready.
 *
 * A reveal can happen in the same commit in which a waiter starts, before the waiter's effect
 * subscribes. So each reveal also gets a sequence number: a waiter reads the mark when it starts
 * (during render) and asks later whether its session showed its rows after that mark.
 */
type TranscriptContentRevealedListener = (sessionId: string) => void;

const listeners = new Set<TranscriptContentRevealedListener>();
let revealSequence = 0;
const lastRevealSequenceBySessionId = new Map<string, number>();

/** The transcript calls this once per session entry, after the commit that removed its cover. */
export function notifyTranscriptContentRevealed(sessionId: string): void {
    revealSequence += 1;
    lastRevealSequenceBySessionId.set(sessionId, revealSequence);
    for (const listener of Array.from(listeners)) listener(sessionId);
}

export function subscribeTranscriptContentRevealed(listener: TranscriptContentRevealedListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The current position in the reveal sequence. Reveals after this mark are newer. */
export function readTranscriptContentRevealMark(): number {
    return revealSequence;
}

export function wasTranscriptContentRevealedSince(sessionId: string, mark: number): boolean {
    return (lastRevealSequenceBySessionId.get(sessionId) ?? 0) > mark;
}
