import * as React from 'react';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { useSessionImagePreview } from '@/components/sessions/files/content/imagePreview/useSessionImagePreview';
import { SafeNativeSvgXml } from '@/components/ui/media/SafeNativeSvgXml';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import {
    StoryDeckSlideTransition,
    type StoryDeckSlideTransitionHandle,
    type StoryDeckSlideTransitionRole,
} from '@/components/ui/motion';
import { Modal } from '@/modal';

import {
    resolveViewerImageFileName,
    saveViewerImage,
    shareViewerImage,
    type ViewerImageFile,
} from './imageViewerActions';

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
}>;

const stylesheet = StyleSheet.create((theme) => ({
    body: {
        flex: 1,
        backgroundColor: theme.colors.surface.inset,
    },
    imageSurface: {
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: theme.colors.surface.elevated,
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
        color: theme.colors.text.secondary,
        fontSize: 13,
        textAlign: 'center',
        ...Typography.default('regular'),
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
        backgroundColor: theme.colors.overlay.scrim,
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
    headerAction: {
        padding: 2,
    },
    headerActionDisabled: {
        opacity: 0.35,
    },
}));

/** The URI an image shows once it has loaded, or null while it loads or after an error. */
type ResolvedImageUri = Readonly<{ image: AttachmentImagePreviewModalImage; uri: string | null }>;

const AttachmentImagePreviewImageSlide = React.memo(function AttachmentImagePreviewImageSlide(props: Readonly<{
    image: AttachmentImagePreviewModalImage;
    onResolvedUri?: (resolved: ResolvedImageUri) => void;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
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

    if (props.image.kind === 'direct') {
        return (
            <Image
                accessibilityRole="image"
                source={{ uri: props.image.uri }}
                style={[{ width: '100%', height: '100%' }, styles.image]}
                contentFit="contain"
            />
        );
    }

    if (preview.status === 'loaded') {
        if (Platform.OS !== 'web' && preview.svgXml) {
            return <SafeNativeSvgXml xml={preview.svgXml} width="100%" height="100%" />;
        }
        return (
            <Image
                accessibilityRole="image"
                source={{ uri: preview.uri }}
                style={[{ width: '100%', height: '100%' }, styles.image]}
                contentFit="contain"
            />
        );
    }

    if (preview.status === 'error') {
        return (
            <View style={styles.centeredState}>
                <Icon name="warning-circle" size={29} color={theme.colors.text.secondary} />
                <Text style={styles.centeredStateText}>{t('common.error')}</Text>
            </View>
        );
    }

    return (
        <View style={styles.centeredState}>
            <ActivitySpinner size="small" color={theme.colors.text.secondary} />
        </View>
    );
});

type HeaderActionKind = 'share' | 'save';

const AttachmentImagePreviewHeaderActions = React.memo(function AttachmentImagePreviewHeaderActions(props: Readonly<{
    file: ViewerImageFile | null;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [busy, setBusy] = React.useState<HeaderActionKind | null>(null);
    const file = props.file;

    const run = React.useCallback(async (kind: HeaderActionKind) => {
        if (!file || busy) return;
        setBusy(kind);
        try {
            await (kind === 'share' ? shareViewerImage(file) : saveViewerImage(file));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : t('errors.operationFailed'));
        } finally {
            setBusy(null);
        }
    }, [busy, file]);

    const disabled = !file || busy !== null;
    const actions: ReadonlyArray<Readonly<{ kind: HeaderActionKind; icon: 'share' | 'download'; label: string }>> = [
        { kind: 'share', icon: 'share', label: t('files.imageViewer.share') },
        { kind: 'save', icon: 'download', label: t('files.imageViewer.save') },
    ];
    return (
        <>
            {actions.map((action) => (
                <Pressable
                    key={action.kind}
                    testID={`attachment-image-preview-${action.kind}`}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    accessibilityState={{ disabled, busy: busy === action.kind }}
                    disabled={disabled}
                    hitSlop={10}
                    onPress={() => { void run(action.kind); }}
                    style={({ pressed }) => [
                        styles.headerAction,
                        disabled ? styles.headerActionDisabled : null,
                        pressed && !disabled ? { opacity: 0.7 } : null,
                    ]}
                >
                    <Icon name={action.icon} size={20} color={theme.colors.text.secondary} />
                </Pressable>
            ))}
        </>
    );
});

export const AttachmentImagePreviewModal = React.memo(function AttachmentImagePreviewModal(props: AttachmentImagePreviewModalProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const { width, height } = useWindowDimensions();
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

    React.useEffect(() => {
        setCurrentIndex(clampedInitialIndex);
    }, [clampedInitialIndex]);

    const containerWidth = Math.max(280, Math.min(width - 24, 960));
    const containerHeight = Math.max(240, Math.min(height - 24, 840));
    const currentImage = props.images[currentIndex] ?? props.images[0] ?? null;
    const hasMultipleImages = imageCount > 1;
    const canGoPrevious = currentIndex > 0;
    const canGoNext = currentIndex < imageCount - 1;
    const shouldShowNavigation = hasMultipleImages && (Platform.OS === 'web' ? isHovered : true);

    const commitNext = React.useCallback(() => {
        setCurrentIndex((value) => Math.min(imageCount - 1, value + 1));
    }, [imageCount]);
    const commitPrevious = React.useCallback(() => {
        setCurrentIndex((value) => Math.max(0, value - 1));
    }, []);

    const renderSlide = React.useCallback((index: number, role: StoryDeckSlideTransitionRole) => {
        const image = props.images[index];
        if (!image) return null;
        return (
            <View style={styles.slide}>
                <AttachmentImagePreviewImageSlide
                    image={image}
                    onResolvedUri={role === 'current' ? setResolved : undefined}
                />
            </View>
        );
    }, [props.images, styles.slide]);

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

    const maxHeightRatio = height > 0 ? (containerHeight / height) : 0.92;
    const chromeDimensions = React.useMemo(() => ({
        width: containerWidth,
        maxHeightRatio,
        size: 'lg' as const,
    }), [containerWidth, maxHeightRatio]);

    const chrome = React.useMemo(() => currentImage ? ({
        kind: 'card' as const,
        title: currentImage.title,
        ...(hasMultipleImages ? {
            subtitle: t('files.imageViewer.position', { current: currentIndex + 1, total: imageCount }),
            subtitleTestID: 'attachment-image-preview-index',
        } : {}),
        actions: <AttachmentImagePreviewHeaderActions file={currentFile} />,
        testID: 'attachment-image-preview-modal',
        titleTestID: 'attachment-image-preview-title',
        dimensions: chromeDimensions,
        layout: 'fill' as const,
    }) : null, [chromeDimensions, currentFile, currentImage, currentIndex, hasMultipleImages, imageCount]);

    useModalCardChrome(props.setChrome, chrome);

    if (!currentImage) return null;

    return (
        <View style={styles.body}>
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
                            <Icon name="caret-left" size={24} color={theme.colors.overlay.foreground} />
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
                            <Icon name="caret-right" size={24} color={theme.colors.overlay.foreground} />
                        </Pressable>
                    </>
                ) : null}
            </Pressable>
        </View>
    );
});
