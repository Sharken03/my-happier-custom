import * as React from 'react';
import { useRouter } from 'expo-router';

import type { ParsedSessionMediaMessageMeta } from '@/sync/domains/sessionMedia/sessionMediaMessageMeta';
import type { TranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import { buildSessionFileDeepLink } from '@/utils/url/sessionFileDeepLink';

import { SessionMediaInlineImages } from './SessionMediaInlineImages';
import { SessionMediaUnavailableItems } from './SessionMediaUnavailableItems';

/**
 * The media of one tool call result: the image tiles and the unavailable items. The transcript
 * row and the tool call detail both render it, so the two show the same media.
 */
export function ToolResultMedia(props: Readonly<{
    sessionId: string;
    media: ParsedSessionMediaMessageMeta;
    interaction: TranscriptInteraction | undefined;
}>): React.ReactElement | null {
    const router = useRouter();
    const { sessionId } = props;
    const handleOpenPath = React.useCallback((filePath: string) => {
        router.push(buildSessionFileDeepLink({ sessionId, filePath }) as never);
    }, [router, sessionId]);

    if (props.media.inlineImages.length === 0 && props.media.unavailableMedia.length === 0) return null;
    return (
        <>
            {props.media.inlineImages.length > 0 ? (
                <SessionMediaInlineImages
                    sessionId={sessionId}
                    media={props.media.inlineImages}
                    onOpenPath={handleOpenPath}
                    fileOpenEnabled={props.interaction?.canOpenFiles === true}
                    mediaPreviewEnabled={props.interaction?.canPreviewMedia === true}
                />
            ) : null}
            <SessionMediaUnavailableItems items={props.media.unavailableMedia} />
        </>
    );
}
