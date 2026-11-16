import type { ReducerState } from '@/sync/reducer/reducer';

export type RunningToolRepairTargets = Readonly<{
    minSeq: number;
    messageIds: readonly string[];
    messageSeqs: Readonly<Record<string, number>>;
}>;

/**
 * Returns the tool-call rows of the main timeline whose tool is still running.
 *
 * A tool result is one server row that gets new revisions in place. `afterSeq` catch-up never
 * reads a row again after the device has its seq, and AccountChange keeps only the latest hint
 * per session. So a revision that completes a tool while the socket is down can be lost. A
 * repair page that starts at the tool-call row also refreshes the result row that follows it.
 */
export function collectRunningToolRepairTargets(
    reducerState: Pick<ReducerState, 'messages'> | null | undefined,
): RunningToolRepairTargets | null {
    if (!reducerState) return null;
    const messageIds: string[] = [];
    const messageSeqs: Record<string, number> = {};
    let minSeq = Number.POSITIVE_INFINITY;
    for (const message of reducerState.messages.values()) {
        if (message.tool?.state !== 'running') continue;
        const realId = typeof message.realID === 'string' ? message.realID.trim() : '';
        const seq = message.seq;
        if (!realId || typeof seq !== 'number' || !Number.isFinite(seq) || seq <= 0) continue;
        if (messageSeqs[realId] !== undefined) continue;
        messageIds.push(realId);
        messageSeqs[realId] = seq;
        minSeq = Math.min(minSeq, seq);
    }
    if (messageIds.length === 0) return null;
    return { minSeq, messageIds, messageSeqs };
}
