import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';

import { transcriptMarkdownTextStyle } from '@/components/sessions/transcript/transcriptMarkdownTypography';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { TranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import { buildSessionFileDeepLink } from '@/utils/url/sessionFileDeepLink';

import { SessionMediaInlineImages } from './SessionMediaInlineImages';
import type { SharedImageToolCallPresentation } from './sharedImageToolCall';
import {
    SHARED_IMAGE_CAPTION_MARGIN_TOP_PX,
    SHARED_IMAGE_ROW_HORIZONTAL_MARGIN_PX,
    SHARED_IMAGE_ROW_PADDING_BOTTOM_PX,
    resolveSharedImageAvailableWidthPx,
} from './sessionMediaSharedImageLayout';

/**
 * A `show_image` call as the transcript draws it: the images as wide as the reply column, then
 * the caption. No tool chrome. The row height estimate
 * (`estimateTranscriptRowHeightFromContent`) adds up the same constants and box sizes.
 */
export const SharedImageToolCallRow = React.memo(function SharedImageToolCallRow(props: Readonly<{
    sessionId: string;
    messageId: string;
    presentation: SharedImageToolCallPresentation;
    transcriptContentWidthPx: number;
    interaction: TranscriptInteraction | undefined;
}>) {
    const router = useRouter();
    const { sessionId } = props;
    const handleOpenPath = React.useCallback((filePath: string) => {
        router.push(buildSessionFileDeepLink({ sessionId, filePath }) as never);
    }, [router, sessionId]);

    return (
        <View testID={`transcript-shared-image:${props.messageId}`} style={styles.container}>
            <SessionMediaInlineImages
                sessionId={sessionId}
                media={props.presentation.images}
                onOpenPath={handleOpenPath}
                fileOpenEnabled={props.interaction?.canOpenFiles === true}
                mediaPreviewEnabled={props.interaction?.canPreviewMedia === true}
                fullWidthPx={resolveSharedImageAvailableWidthPx(props.transcriptContentWidthPx)}
                containerTestID="transcript-shared-image-boxes"
                imageTestIDPrefix="transcript-shared-image-box"
                previewTestIDPrefix="transcript-shared-image-preview"
            />
            {props.presentation.caption ? (
                <Text testID="transcript-shared-image-caption" style={styles.caption}>
                    {props.presentation.caption}
                </Text>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        marginHorizontal: SHARED_IMAGE_ROW_HORIZONTAL_MARGIN_PX,
        paddingBottom: SHARED_IMAGE_ROW_PADDING_BOTTOM_PX,
        alignSelf: 'stretch',
    },
    caption: {
        ...Typography.default('regular'),
        ...transcriptMarkdownTextStyle,
        marginTop: SHARED_IMAGE_CAPTION_MARGIN_TOP_PX,
        color: theme.colors.text.secondary,
    },
}));
