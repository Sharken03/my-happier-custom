import * as React from 'react';
import {
    Image,
    Platform,
    Pressable,
    View,
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { t } from '@/text';
import { useSessionImagePreview } from '@/components/sessions/files/content/imagePreview/useSessionImagePreview';
import type { AttachmentImagePreviewModalImage } from '@/components/sessions/attachments/preview/AttachmentImagePreviewModal';
import { buildSessionMediaViewerImage } from '@/components/sessions/attachments/preview/chatImageGallery';
import { openChatImageViewer } from '@/components/sessions/attachments/preview/openChatImageViewer';
import * as FlashListCompat from '@/components/ui/lists/flashListCompat/FlashListCompat';
import { SafeNativeSvgXml } from '@/components/ui/media/SafeNativeSvgXml';
import type { SessionMediaInlineImageSummary } from '@/sync/domains/sessionMedia/sessionMediaMessageMeta';

import { resolveSessionMediaImageMimeType } from './sessionMediaPresentation';
import {
    SESSION_MEDIA_INLINE_IMAGES_GAP_PX,
    SESSION_MEDIA_INLINE_IMAGES_MARGIN_BOTTOM_PX,
    SESSION_MEDIA_INLINE_IMAGES_MARGIN_TOP_PX,
    resolveImageDimensions,
    resolveThumbnailSize,
    type ImageDimensions,
} from './sessionMediaThumbnailLayout';
import { SHARED_IMAGE_GAP_PX, resolveSharedImageBoxSize } from './sessionMediaSharedImageLayout';
import { Icon } from '@/components/ui/icons/Icon';

const fallbackSessionMediaMappingHelper: FlashListCompat.FlashListMappingHelper = {
    getMappingKey: (itemKey: FlashListCompat.FlashListMappingKey) => itemKey,
};

function useSessionMediaMappingHelper(): FlashListCompat.FlashListMappingHelper {
    return typeof FlashListCompat.useMappingHelper === 'function'
        ? FlashListCompat.useMappingHelper()
        : fallbackSessionMediaMappingHelper;
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        marginTop: SESSION_MEDIA_INLINE_IMAGES_MARGIN_TOP_PX,
        marginBottom: SESSION_MEDIA_INLINE_IMAGES_MARGIN_BOTTOM_PX,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SESSION_MEDIA_INLINE_IMAGES_GAP_PX,
    },
    fullWidthContainer: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: SHARED_IMAGE_GAP_PX,
    },
    tile: {
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.elevated,
    },
    image: {
        width: '100%',
        height: '100%',
    },
    placeholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface.elevated,
    },
}));

function resolveSessionMediaAccessibilityLabel(media: SessionMediaInlineImageSummary): string {
    const accessibleName = (media.description ?? media.name).slice(0, 512);
    if (media.category === 'attachment') {
        return t('files.sessionMedia.attachmentImageA11y', { name: accessibleName });
    }
    if (media.category === 'tool-artifact') {
        return t('files.sessionMedia.toolArtifactImageA11y', { name: accessibleName });
    }
    return t('files.sessionMedia.generatedImageA11y', { name: accessibleName });
}

function SessionMediaInlineImagePreviewTile(props: Readonly<{
    sessionId: string;
    media: SessionMediaInlineImageSummary;
    mimeType: string;
    imageIndex: number;
    size: ImageDimensions;
    onOpenPath: (path: string) => void;
    fileOpenEnabled: boolean;
    onOpenPreview: (index: number) => void;
    imageTestIDPrefix: string;
    previewTestIDPrefix: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    const preview = useSessionImagePreview({
        sessionId: props.sessionId,
        filePath: props.media.path,
        enabled: true,
        cacheKey: props.media.sha256 ?? null,
        mimeType: props.mimeType,
        sizeBytes: props.media.sizeBytes,
    });
    const accessibilityLabel = resolveSessionMediaAccessibilityLabel(props.media);

    return (
        <Pressable
            testID={`${props.imageTestIDPrefix}:${props.media.path}`}
            accessibilityRole="imagebutton"
            accessibilityLabel={accessibilityLabel}
            onPress={() => {
                if (preview.status === 'error') {
                    if (props.fileOpenEnabled) {
                        props.onOpenPath(props.media.path);
                    }
                    return;
                }
                props.onOpenPreview(props.imageIndex);
            }}
            style={[styles.tile, props.size]}
        >
            {preview.status === 'loaded' ? (
                Platform.OS !== 'web' && preview.svgXml ? (
                    // SVG stays supported, but only after the daemon preview path has read an authorized session file.
                    // Never render transcript-inline XML, provider URLs, or file:// sources here.
                    <SafeNativeSvgXml xml={preview.svgXml} width="100%" height="100%" />
                ) : (
                    <Image
                        testID={`${props.previewTestIDPrefix}:${props.media.path}`}
                        source={{ uri: preview.uri }}
                        resizeMode="contain"
                        style={styles.image}
                    />
                )
            ) : (
                <View style={styles.placeholder}>
                    <Icon
                        name={preview.status === 'error' ? 'warning-circle' : 'image'}
                        size={20}
                        color={theme.colors.text.secondary}
                    />
                </View>
            )}
        </Pressable>
    );
}

function SessionMediaInlineImageInertTile(props: Readonly<{
    media: SessionMediaInlineImageSummary;
    size: ImageDimensions;
    imageTestIDPrefix: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    return (
        <View
            testID={`${props.imageTestIDPrefix}:${props.media.path}`}
            accessibilityRole="image"
            accessibilityLabel={resolveSessionMediaAccessibilityLabel(props.media)}
            style={[styles.tile, props.size]}
        >
            <View style={styles.placeholder}>
                <Icon
                    name="image"
                    size={20}
                    color={theme.colors.text.secondary}
                />
            </View>
        </View>
    );
}

export const SessionMediaInlineImages = React.memo(function SessionMediaInlineImages(props: Readonly<{
    sessionId: string;
    media: readonly SessionMediaInlineImageSummary[];
    onOpenPath: (path: string) => void;
    fileOpenEnabled: boolean;
    mediaPreviewEnabled: boolean;
    containerTestID?: string;
    imageTestIDPrefix?: string;
    previewTestIDPrefix?: string;
    /**
     * Stack the images in boxes as wide as this width allows (`resolveSharedImageBoxSize`),
     * as for an image the agent shares, instead of a row of thumbnails.
     */
    fullWidthPx?: number;
}>) {
    const styles = stylesheet;
    const containerTestID = props.containerTestID ?? 'message-session-media-inline-images';
    const imageTestIDPrefix = props.imageTestIDPrefix ?? 'message-session-media-inline-image';
    const previewTestIDPrefix = props.previewTestIDPrefix ?? 'message-session-media-inline-image-preview';
    const { getMappingKey } = useSessionMediaMappingHelper();

    const images = React.useMemo(() => {
        const result: Array<Readonly<{
            media: SessionMediaInlineImageSummary;
            mimeType: string;
            modalImage: AttachmentImagePreviewModalImage;
        }>> = [];
        for (const media of props.media) {
            const mimeType = resolveSessionMediaImageMimeType(media);
            if (!mimeType) continue;
            result.push({
                media,
                mimeType,
                modalImage: buildSessionMediaViewerImage(props.sessionId, media, mimeType),
            });
        }
        return result;
    }, [props.media, props.sessionId]);

    if (images.length === 0) return null;

    const fullWidthPx = props.fullWidthPx;
    return (
        <View testID={containerTestID} style={fullWidthPx === undefined ? styles.container : styles.fullWidthContainer}>
            {images.map((entry, index) => {
                const key = getMappingKey(`${entry.media.path}:${entry.media.name}`, index);
                // Sized from the metadata only, as the transcript estimate is: the size never changes on load.
                const size = fullWidthPx === undefined
                    ? resolveThumbnailSize(resolveImageDimensions(entry.media))
                    : resolveSharedImageBoxSize(entry.media, fullWidthPx);
                if (!props.mediaPreviewEnabled) {
                    return (
                        <SessionMediaInlineImageInertTile
                            key={key}
                            media={entry.media}
                            size={size}
                            imageTestIDPrefix={imageTestIDPrefix}
                        />
                    );
                }

                return (
                    <SessionMediaInlineImagePreviewTile
                        key={key}
                        sessionId={props.sessionId}
                        media={entry.media}
                        mimeType={entry.mimeType}
                        imageIndex={index}
                        size={size}
                        onOpenPath={props.onOpenPath}
                        fileOpenEnabled={props.fileOpenEnabled}
                        imageTestIDPrefix={imageTestIDPrefix}
                        previewTestIDPrefix={previewTestIDPrefix}
                        onOpenPreview={(imageIndex) => {
                            const image = images[imageIndex]?.modalImage;
                            if (!image) return;
                            openChatImageViewer({
                                sessionId: props.sessionId,
                                image,
                                siblings: images.map((imageEntry) => imageEntry.modalImage),
                            });
                        }}
                    />
                );
            })}
        </View>
    );
});
