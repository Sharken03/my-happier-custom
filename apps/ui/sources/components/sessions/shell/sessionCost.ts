import React from 'react';
import { useAuth } from '@/auth/context/AuthContext';
import { calculateTotals, queryUsage } from '@/sync/api/account/apiUsage';
import { log } from '@/log';
import { useSessionReadyActivity } from '@/sync/store/hooks';

/**
 * The chat's cost for the composer's status row: three decimals below $0.10 ("$0.042"), two above
 * ("$1.23"), nothing for an unknown or zero cost.
 */
export function formatSessionCostUsd(usd: number | null | undefined): string | null {
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return null;
    return `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;
}

// The CLI sends a usage report with each token_count message; the last one of a turn comes before
// the turn's ready event, and the server may store it a moment later.
const REPORT_SETTLE_MS = 1_500;

/**
 * The chat's cost so far: the session's usage reports summed by the server's usage query, the same
 * source and totals as Settings → Usage. Reads again once per finished turn (the session's latest
 * ready event), not on each token count within a turn.
 */
export function useSessionCostUsd(sessionId: string): number | null {
    const refreshKey = useSessionReadyActivity(sessionId).latestReadyEventSeq;
    const auth = useAuth();
    const credentials = auth.credentials;
    const [costUsd, setCostUsd] = React.useState<number | null>(null);

    React.useEffect(() => {
        setCostUsd(null);
    }, [sessionId]);

    React.useEffect(() => {
        if (!credentials) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            queryUsage(credentials, { sessionId })
                .then((response) => {
                    if (!cancelled) setCostUsd(calculateTotals(response.usage ?? []).totalCost);
                })
                .catch((error: unknown) => {
                    // The row keeps the last cost; Settings → Usage shows the error itself.
                    if (!cancelled) log.log(`[session-cost] usage query failed for ${sessionId}: ${String(error)}`);
                });
        }, REPORT_SETTLE_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [credentials, sessionId, refreshKey]);

    return costUsd;
}
