import * as React from 'react';
import { Image, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { AttachmentImagePreviewModal } from '@/components/sessions/attachments/preview/AttachmentImagePreviewModal';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Modal } from '@/modal';

/** Space above and below the box, except at the start and end of the markdown. */
export const MARKDOWN_REMOTE_IMAGE_MARGIN_PX = 8;

/**
 * A markdown image from an allowed host. The box is always 16:9 of the available width, so the
 * row has its final height in the first layout pass. The image fits inside (`contain`), and the
 * box keeps its size when the image loads or fails. A tap opens the fullscreen viewer.
 */
export const MarkdownRemoteImage = React.memo(function MarkdownRemoteImage(props: Readonly<{
    url: string;
    alt: string;
    first: boolean;
    last: boolean;
}>) {
    const { theme } = useUnistyles();
    const [failed, setFailed] = React.useState(false);
    const title = props.alt || hostOf(props.url);
    const onPress = React.useCallback(() => {
        Modal.show({
            component: AttachmentImagePreviewModal,
            props: { images: [{ kind: 'direct', uri: props.url, title }], initialIndex: 0 },
        });
    }, [props.url, title]);

    return (
        <Pressable
            testID="markdown-remote-image"
            accessibilityRole="imagebutton"
            accessibilityLabel={title}
            onPress={onPress}
            style={[
                styles.box,
                {
                    marginTop: props.first ? 0 : MARKDOWN_REMOTE_IMAGE_MARGIN_PX,
                    marginBottom: props.last ? 0 : MARKDOWN_REMOTE_IMAGE_MARGIN_PX,
                },
            ]}
        >
            {failed ? (
                <View testID="markdown-remote-image-failed" style={styles.failed}>
                    <Icon name="image" size={20} color={theme.colors.text.secondary} />
                    <Text style={styles.failedText} numberOfLines={2}>{title}</Text>
                </View>
            ) : (
                <Image
                    source={{ uri: props.url }}
                    resizeMode="contain"
                    style={styles.image}
                    onError={() => setFailed(true)}
                    accessibilityIgnoresInvertColors
                />
            )}
        </Pressable>
    );
});

function hostOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

const styles = StyleSheet.create((theme) => ({
    box: {
        width: '100%',
        aspectRatio: 16 / 9,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface.inset,
    },
    image: {
        width: '100%',
        height: '100%',
    },
    failed: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 16,
    },
    failedText: {
        fontSize: 12,
        textAlign: 'center',
        color: theme.colors.text.secondary,
    },
}));
