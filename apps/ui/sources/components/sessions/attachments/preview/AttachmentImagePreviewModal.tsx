import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { useSessionImagePreview } from '@/components/sessions/files/content/imagePreview/useSessionImagePreview';
import { SafeNativeSvgXml } from '@/components/ui/media/SafeNativeSvgXml';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { CustomModalInjectedProps } from '@/modal';
import { useChromeSafeAreaInsets } from '@/components/ui/layout/useChromeSafeAreaInsets';
import type { PickedAttachment } from '@/components/sessions/attachments/AttachmentFilePicker.types';
import {
    addAttachmentsToSessionComposer,
    hasSessionComposerAttachmentSink,
} from '@/components/sessions/attachments/sessionComposerAttachmentSink';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import {
    StoryDeckSlideTransition,
    type StoryDeckSlideTransitionHandle,
    type StoryDeckSlideTransitionRole,
} from '@/components/ui/motion';
import { Modal } from '@/modal';
import type { CustomModalChromeFullscreenConfig } from '@/modal/types';

import {
    resolveViewerImageFileName,
    saveViewerImage,
    shareViewerImage,
    type ViewerImageFile,
} from './imageViewerActions';
import { truncateFileNameMiddle } from './imageViewerText';
import type { ImageZoomSize } from './imageZoomMath';
import { ImageMarkupEditor } from './markup/ImageMarkupEditor';
import { ZoomableImageSurface } from './ZoomableImageSurface';

export type AttachmentImagePreviewModalImage =
    | Readonly<{
        kind: 'direct';
        uri: string;
        title: string;
    }>
    | Readonly<{
        kind: 'session-image';
        title: string;
        sessionId: string;
        filePath: string;
        mimeType?: string;
        sizeBytes?: number;
        cacheKey?: string | null;
    }>;

type AttachmentImagePreviewModalProps = CustomModalInjectedProps & Readonly<{
    images: ReadonlyArray<AttachmentImagePreviewModalImage>;
    initialIndex?: number;
    /** The session whose composer receives a marked-up image. Without it, edit is hidden. */
    sessionId?: string | null;
}>;

const FULLSCREEN_CHROME: CustomModalChromeFullscreenConfig = { kind: 'fullscreen' };
const TITLE_MAX_CHARS = 22;
const CONTROL_SIZE = 40;
// The viewer is always dark, like a photo viewer, whatever the app theme is.
const VIEWER_BACKGROUND = '#000000';
const VIEWER_FOREGROUND = '#ffffff';
const VIEWER_MUTED = 'rgba(255, 255, 255, 0.7)';
const CONTROL_BACKGROUND = 'rgba(40, 40, 40, 0.9)';

const stylesheet = StyleSheet.create(() => ({
    root: {
        flex: 1,
        backgroundColor: VIEWER_BACKGROUND,
    },
    imageSurface: {
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
    },
    image: {
    },
    centeredState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 24,
    },
    centeredStateText: {
        color: VIEWER_MUTED,
        fontSize: 13,
        textAlign: 'center',
        ...Typography.default('regular'),
    },
    topBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        zIndex: 2,
    },
    pill: {
        minHeight: CONTROL_SIZE,
        paddingHorizontal: 16,
        borderRadius: 999,
        justifyContent: 'center',
        backgroundColor: CONTROL_BACKGROUND,
    },
    titlePill: {
        flexShrink: 1,
    },
    pillText: {
        color: VIEWER_FOREGROUND,
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    roundButton: {
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
        borderRadius: CONTROL_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: CONTROL_BACKGROUND,
    },
    buttonDisabled: {
        opacity: 0.4,
    },
    bottomBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        zIndex: 2,
    },
    navButton: {
        position: 'absolute',
        top: '50%',
        marginTop: -22,
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        backgroundColor: CONTROL_BACKGROUND,
        zIndex: 1,
    },
    navButtonLeft: {
        left: 16,
    },
    navButtonRight: {
        right: 16,
    },
    navButtonDisabled: {
        opacity: 0.35,
    },
    slide: {
        flex: 1,
    },
}));

/** The URI an image shows once it has loaded, or null while it loads or after an error. */
type ResolvedImageUri = Readonly<{ image: AttachmentImagePreviewModalImage; uri: string | null }>;

function readLoadedImageSize(event: { source?: { width?: number; height?: number } }): ImageZoomSize | null {
    const width = event.source?.width ?? 0;
    const height = event.source?.height ?? 0;
    return width > 0 && height > 0 ? { width, height } : null;
}

const AttachmentImagePreviewImageSlide = React.memo(function AttachmentImagePreviewImageSlide(props: Readonly<{
    image: AttachmentImagePreviewModalImage;
    active: boolean;
    onResolvedUri?: (resolved: ResolvedImageUri) => void;
    onZoomedChange?: (zoomed: boolean) => void;
    onSingleTap?: () => void;
}>) {
    const styles = stylesheet;
    const [imageSize, setImageSize] = React.useState<ImageZoomSize | null>(null);
    const preview = useSessionImagePreview({
        sessionId: props.image.kind === 'session-image' ? props.image.sessionId : '',
        filePath: props.image.kind === 'session-image' ? props.image.filePath : '',
        enabled: props.image.kind === 'session-image',
        cacheKey: props.image.kind === 'session-image' ? props.image.cacheKey ?? null : null,
        mimeType: props.image.kind === 'session-image' ? props.image.mimeType ?? null : null,
        sizeBytes: props.image.kind === 'session-image' ? props.image.sizeBytes ?? null : null,
    });
    const resolvedUri = props.image.kind === 'direct'
        ? props.image.uri
        : preview.status === 'loaded' ? preview.uri : null;

    const onResolvedUri = props.onResolvedUri;
    React.useEffect(() => {
        onResolvedUri?.({ image: props.image, uri: resolvedUri });
    }, [onResolvedUri, props.image, resolvedUri]);

    const onImageLoad = React.useCallback((event: { source?: { width?: number; height?: number } }) => {
        setImageSize(readLoadedImageSize(event));
    }, []);

    let content: React.ReactNode;
    if (props.image.kind === 'session-image' && preview.status === 'loaded' && Platform.OS !== 'web' && preview.svgXml) {
        content = <SafeNativeSvgXml xml={preview.svgXml} width="100%" height="100%" />;
    } else if (resolvedUri) {
        content = (
            <Image
                accessibilityRole="image"
                source={{ uri: resolvedUri }}
                style={[{ width: '100%', height: '100%' }, styles.image]}
                contentFit="contain"
                onLoad={onImageLoad}
            />
        );
    } else if (preview.status === 'error') {
        return (
            <View style={styles.centeredState}>
                <Icon name="warning-circle" size={29} color={VIEWER_MUTED} />
                <Text style={styles.centeredStateText}>{t('common.error')}</Text>
            </View>
        );
    } else {
        return (
            <View style={styles.centeredState}>
                <ActivitySpinner size="small" color={VIEWER_MUTED} />
            </View>
        );
    }

    return (
        <ZoomableImageSurface
            active={props.active}
            imageSize={imageSize}
            onZoomedChange={props.onZoomedChange}
            onSingleTap={props.onSingleTap}
            testID="attachment-image-preview-zoom"
        >
            {content}
        </ZoomableImageSurface>
    );
});

type FileActionKind = 'share' | 'save';

const ViewerRoundButton = React.memo(function ViewerRoundButton(props: Readonly<{
    testID: string;
    icon: 'pencil-simple' | 'share' | 'download' | 'x';
    label: string;
    disabled?: boolean;
    busy?: boolean;
    onPress: () => void;
}>) {
    const styles = stylesheet;
    const disabled = props.disabled === true;
    return (
        <Pressable
            testID={props.testID}
            accessibilityRole="button"
            accessibilityLabel={props.label}
            accessibilityState={{ disabled, busy: props.busy === true }}
            disabled={disabled}
            hitSlop={6}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.roundButton,
                disabled ? styles.buttonDisabled : null,
                pressed && !disabled ? { opacity: 0.7 } : null,
            ]}
        >
            {props.busy
                ? <ActivitySpinner size="small" color={VIEWER_FOREGROUND} />
                : <Icon name={props.icon} size={20} color={VIEWER_FOREGROUND} />}
        </Pressable>
    );
});

export const AttachmentImagePreviewModal = React.memo(function AttachmentImagePreviewModal(props: AttachmentImagePreviewModalProps) {
    const styles = stylesheet;
    const insets = useChromeSafeAreaInsets();
    const slideRef = React.useRef<StoryDeckSlideTransitionHandle | null>(null);
    const imageCount = props.images.length;
    const clampedInitialIndex = React.useMemo(() => {
        if (imageCount === 0) return 0;
        const raw = typeof props.initialIndex === 'number' ? props.initialIndex : 0;
        return Math.max(0, Math.min(raw, imageCount - 1));
    }, [imageCount, props.initialIndex]);
    const [currentIndex, setCurrentIndex] = React.useState(clampedInitialIndex);
    const [isHovered, setIsHovered] = React.useState(false);
    const [resolved, setResolved] = React.useState<ResolvedImageUri | null>(null);
    const [zoomed, setZoomed] = React.useState(false);
    const [chromeVisible, setChromeVisible] = React.useState(true);
    const [editing, setEditing] = React.useState(false);
    const [busyAction, setBusyAction] = React.useState<FileActionKind | null>(null);

    const setChrome = props.setChrome;
    React.useLayoutEffect(() => {
        setChrome?.(FULLSCREEN_CHROME);
    }, [setChrome]);

    React.useEffect(() => {
        setCurrentIndex(clampedInitialIndex);
    }, [clampedInitialIndex]);

    const currentImage = props.images[currentIndex] ?? props.images[0] ?? null;
    const hasMultipleImages = imageCount > 1;
    const canGoPrevious = currentIndex > 0;
    const canGoNext = currentIndex < imageCount - 1;
    const shouldShowNavigation = chromeVisible && hasMultipleImages && Platform.OS === 'web' && isHovered;

    const commitNext = React.useCallback(() => {
        setZoomed(false);
        setCurrentIndex((value) => Math.min(imageCount - 1, value + 1));
    }, [imageCount]);
    const commitPrevious = React.useCallback(() => {
        setZoomed(false);
        setCurrentIndex((value) => Math.max(0, value - 1));
    }, []);
    const toggleChrome = React.useCallback(() => {
        setChromeVisible((value) => !value);
    }, []);

    const renderSlide = React.useCallback((index: number, role: StoryDeckSlideTransitionRole) => {
        const image = props.images[index];
        if (!image) return null;
        const isCurrent = role === 'current';
        return (
            <View style={styles.slide}>
                <AttachmentImagePreviewImageSlide
                    image={image}
                    active={isCurrent}
                    onResolvedUri={isCurrent ? setResolved : undefined}
                    onZoomedChange={isCurrent ? setZoomed : undefined}
                    onSingleTap={isCurrent ? toggleChrome : undefined}
                />
            </View>
        );
    }, [props.images, styles.slide, toggleChrome]);

    // The resolved URI belongs to the image that reported it, so a swipe never shares the old one.
    const resolvedUri = resolved && currentImage && resolved.image === currentImage ? resolved.uri : null;
    const currentFile = React.useMemo<ViewerImageFile | null>(() => {
        if (!currentImage || !resolvedUri) return null;
        const mimeType = currentImage.kind === 'session-image' ? currentImage.mimeType ?? null : null;
        return {
            uri: resolvedUri,
            name: resolveViewerImageFileName({ title: currentImage.title, uri: resolvedUri, mimeType }),
            mimeType,
        };
    }, [currentImage, resolvedUri]);

    const runFileAction = React.useCallback(async (kind: FileActionKind) => {
        if (!currentFile || busyAction) return;
        setBusyAction(kind);
        try {
            await (kind === 'share' ? shareViewerImage(currentFile) : saveViewerImage(currentFile));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : t('errors.operationFailed'));
        } finally {
            setBusyAction(null);
        }
    }, [busyAction, currentFile]);

    const sessionId = props.sessionId ?? null;
    const canEdit = hasSessionComposerAttachmentSink(sessionId);
    const onClose = props.onClose;
    const finishMarkup = React.useCallback((attachment: PickedAttachment) => {
        if (!addAttachmentsToSessionComposer(sessionId, [attachment])) {
            Modal.alert(t('common.error'), t('errors.operationFailed'));
            return;
        }
        setEditing(false);
        onClose();
    }, [onClose, sessionId]);
    const cancelMarkup = React.useCallback(() => setEditing(false), []);

    if (!currentImage) return null;

    // The newest mounted StatusBar wins; the app's own style returns when the viewer unmounts.
    const statusBar = <StatusBar style="light" />;

    if (editing && currentFile) {
        return (
            <View style={styles.root} testID="attachment-image-preview-modal">
                {statusBar}
                <ImageMarkupEditor
                    uri={currentFile.uri}
                    fileName={currentFile.name}
                    onCancel={cancelMarkup}
                    onDone={finishMarkup}
                />
            </View>
        );
    }

    const fileActionsDisabled = !currentFile || busyAction !== null;

    return (
        <View style={styles.root} testID="attachment-image-preview-modal">
            {statusBar}
            <Pressable
                testID="attachment-image-preview-surface"
                style={styles.imageSurface}
                onHoverIn={Platform.OS === 'web' ? () => setIsHovered(true) : undefined}
                onHoverOut={Platform.OS === 'web' ? () => setIsHovered(false) : undefined}
            >
                <StoryDeckSlideTransition
                    ref={slideRef}
                    activeIndex={currentIndex}
                    itemCount={imageCount}
                    renderItem={renderSlide}
                    onCommitNext={commitNext}
                    onCommitPrevious={commitPrevious}
                    gestureThresholdRatio={0.2}
                    gestureEnabled={!zoomed}
                    blur={false}
                    testID="attachment-image-preview-gallery"
                />

                {shouldShowNavigation ? (
                    <>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('common.previous')}
                            disabled={!canGoPrevious}
                            hitSlop={10}
                            onPress={() => slideRef.current?.commitPrevious()}
                            style={({ pressed }) => [
                                styles.navButton,
                                styles.navButtonLeft,
                                !canGoPrevious ? styles.navButtonDisabled : null,
                                pressed && canGoPrevious ? { opacity: 0.85 } : null,
                            ]}
                            testID="attachment-image-preview-previous"
                        >
                            <Icon name="caret-left" size={24} color={VIEWER_FOREGROUND} />
                        </Pressable>

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('common.next')}
                            disabled={!canGoNext}
                            hitSlop={10}
                            onPress={() => slideRef.current?.commitNext()}
                            style={({ pressed }) => [
                                styles.navButton,
                                styles.navButtonRight,
                                !canGoNext ? styles.navButtonDisabled : null,
                                pressed && canGoNext ? { opacity: 0.85 } : null,
                            ]}
                            testID="attachment-image-preview-next"
                        >
                            <Icon name="caret-right" size={24} color={VIEWER_FOREGROUND} />
                        </Pressable>
                    </>
                ) : null}
            </Pressable>

            {chromeVisible ? (
                <>
                    <View
                        pointerEvents="box-none"
                        style={[styles.topBar, {
                            paddingTop: insets.top + 12,
                            paddingLeft: insets.left + 12,
                            paddingRight: insets.right + 12,
                        }]}
                    >
                        <View style={[styles.pill, styles.titlePill]}>
                            <Text
                                testID="attachment-image-preview-title"
                                style={styles.pillText}
                                numberOfLines={1}
                                accessibilityLabel={currentImage.title}
                            >
                                {truncateFileNameMiddle(currentImage.title, TITLE_MAX_CHARS)}
                            </Text>
                        </View>
                        <View style={styles.actions}>
                            {canEdit ? (
                                <ViewerRoundButton
                                    testID="attachment-image-preview-edit"
                                    icon="pencil-simple"
                                    label={t('files.imageViewer.edit')}
                                    disabled={!currentFile || busyAction !== null}
                                    onPress={() => setEditing(true)}
                                />
                            ) : null}
                            <ViewerRoundButton
                                testID="attachment-image-preview-share"
                                icon="share"
                                label={t('files.imageViewer.share')}
                                disabled={fileActionsDisabled}
                                busy={busyAction === 'share'}
                                onPress={() => { void runFileAction('share'); }}
                            />
                            <ViewerRoundButton
                                testID="attachment-image-preview-save"
                                icon="download"
                                label={t('files.imageViewer.save')}
                                disabled={fileActionsDisabled}
                                busy={busyAction === 'save'}
                                onPress={() => { void runFileAction('save'); }}
                            />
                            <ViewerRoundButton
                                testID="attachment-image-preview-close"
                                icon="x"
                                label={t('common.close')}
                                onPress={onClose}
                            />
                        </View>
                    </View>

                    {hasMultipleImages ? (
                        <View pointerEvents="none" style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
                            <View style={styles.pill}>
                                <Text testID="attachment-image-preview-index" style={styles.pillText}>
                                    {t('files.imageViewer.position', { current: currentIndex + 1, total: imageCount })}
                                </Text>
                            </View>
                        </View>
                    ) : null}
                </>
            ) : null}
        </View>
    );
});
