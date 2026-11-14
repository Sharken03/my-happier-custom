import * as React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { useSession } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { SessionInvalidLinkFallback } from '@/components/sessions/shell/SessionInvalidLinkFallback';
import { ToolCallsSheetView } from '@/components/sessions/transcript/toolCallsSheet/ToolCallsSheetView';
import { useToolCallsGroup } from '@/components/sessions/transcript/toolCallsSheet/useToolCallsGroup';
import { useSessionRouteServerScope, type SessionRouteServerScope } from '@/hooks/session/sessionRouteServerScope';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { useSessionRealtimeTranscriptConsumer } from '@/hooks/session/useSessionRealtimeTranscriptConsumer';
import { isSessionRouteHydrationMissing } from '@/sync/domains/session/sessionRouteHydrationState';

type ToolCallsRouteParams = Readonly<{
    id?: string | string[];
    serverId?: string | string[];
    anchorId?: string | string[];
}>;

function normalizeRouteParam(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
    return '';
}

export default React.memo(function SessionToolCallsRoute() {
    const params = useLocalSearchParams<ToolCallsRouteParams>();
    const routeScope = useSessionRouteServerScope(params);
    const sessionId = normalizeRouteParam(params.id);
    const anchorId = normalizeRouteParam(params.anchorId);

    if (!sessionId || !anchorId) {
        return <SessionInvalidLinkFallback />;
    }

    return <SessionToolCallsRouteLoaded sessionId={sessionId} anchorId={anchorId} routeScope={routeScope} />;
});

function SessionToolCallsRouteLoaded(props: {
    sessionId: string;
    anchorId: string;
    routeScope: SessionRouteServerScope;
}) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const session = useSession(props.sessionId);
    const group = useToolCallsGroup(props.sessionId, props.anchorId);

    React.useEffect(() => {
        sync.onSessionVisible(props.sessionId);
    }, [props.sessionId]);

    // The sheet renders live transcript content outside the chat screen, so it registers as a
    // transcript consumer to keep realtime projection running while it is open.
    useSessionRealtimeTranscriptConsumer(props.sessionId);

    const routeHydrationState = useHydrateSessionForRoute(
        props.sessionId,
        'ToolCallsRoute.ensureSessionVisible',
        props.routeScope.hydrationOptions,
    );
    const sessionMissingAfterHydration = isSessionRouteHydrationMissing(routeHydrationState) && !session;

    const handleClose = React.useCallback(() => {
        const canGoBack = typeof router.canGoBack === 'function' ? router.canGoBack() : false;
        if (canGoBack) {
            router.back();
            return;
        }
        router.replace(props.routeScope.buildHref(props.sessionId));
    }, [props.routeScope, props.sessionId, router]);

    // The group is gone when its anchor left the transcript, for example after a cleared session.
    React.useEffect(() => {
        if (group.isLoaded && session && !group.calls) handleClose();
    }, [group.calls, group.isLoaded, handleClose, session]);

    if (sessionMissingAfterHydration) {
        return <SessionInvalidLinkFallback />;
    }

    if (!session || !group.isLoaded || !group.calls) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivitySpinner size="small" color={theme.colors.text.secondary} />
            </View>
        );
    }

    return (
        <ToolCallsSheetView
            sessionId={props.sessionId}
            session={session}
            calls={group.calls}
            isTranscriptTail={group.isTranscriptTail}
            onClose={handleClose}
        />
    );
}
