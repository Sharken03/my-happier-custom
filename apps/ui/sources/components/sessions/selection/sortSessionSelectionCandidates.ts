import {
    compareSessionListSessionOrderingKeys,
    readSessionListUpdatedOrderingKey,
} from '@/sync/domains/session/listing/sessionListOrderingRules';

type OrderingCandidate = Readonly<{
    id: string;
    active?: boolean | null;
    meaningfulActivityAt?: number | null;
    updatedAt?: number | null;
    createdAt?: number | null;
}>;

export function sortSessionSelectionCandidates<T extends OrderingCandidate>(sessions: ReadonlyArray<T>): T[] {
    const orderingKey = (session: T) => ({
        active: session.active === true,
        updated: readSessionListUpdatedOrderingKey(session),
        createdAt: typeof session.createdAt === 'number' && Number.isFinite(session.createdAt) ? session.createdAt : 0,
        stableId: session.id.trim(),
    });
    return [...sessions].sort((left, right) => compareSessionListSessionOrderingKeys(
        orderingKey(left), orderingKey(right), 'updated',
    ));
}
