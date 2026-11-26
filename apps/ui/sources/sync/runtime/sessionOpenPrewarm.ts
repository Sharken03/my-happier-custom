/**
 * Starts the network work for a session open at tap time, before the route mounts.
 *
 * The session route hydrates the session and the session view then starts the transcript
 * fetch, both only after their screens render. The sync runtime registers the handler, so
 * navigation code does not import the sync runtime.
 */
export type SessionOpenPrewarmOptions = Readonly<{
    /** No tap is waiting, so the prewarm may also do CPU work the open would otherwise do. */
    background?: boolean;
}>;

export type SessionOpenPrewarmHandler = (
    sessionId: string,
    serverId: string | null,
    options?: SessionOpenPrewarmOptions,
) => void;

let handler: SessionOpenPrewarmHandler | null = null;

export function setSessionOpenPrewarmHandler(next: SessionOpenPrewarmHandler | null): void {
    handler = next;
}

export function requestSessionOpenPrewarm(
    sessionId: string,
    serverId: string | null,
    options?: SessionOpenPrewarmOptions,
): void {
    const normalized = sessionId.trim();
    if (!normalized || !handler) return;
    try {
        handler(normalized, serverId && serverId.trim() ? serverId.trim() : null, options);
    } catch {
        // Prewarm is an optimization; the route still hydrates the session on its own.
    }
}
