import * as React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { ContextMenu, type ContextMenuItem } from '@/components/ui/forms/dropdown/ContextMenu';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal, type CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { t } from '@/text';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';

const COPY_ITEM_ID = 'copy';
const SELECT_TEXT_ITEM_ID = 'selectText';

/**
 * The person's own message as in the Claude app: a long press opens Copy message and Select text.
 * Select text shows the whole message as one selectable text, so a selection can span paragraphs,
 * which the transcript's per-block text cannot do on native.
 */
export function UserMessageLongPressMenu(props: Readonly<{
    /** Off: the wrapper is inert, so in-place text selection keeps the long press. */
    enabled: boolean;
    text: string;
    messageId: string;
    style?: StyleProp<ViewStyle>;
    children: React.ReactNode;
}>) {
    const anchorRef = React.useRef<View>(null);
    const [open, setOpen] = React.useState(false);
    const hasText = props.enabled && props.text.trim().length > 0;

    const items = React.useMemo<ContextMenuItem[]>(() => [
        { id: COPY_ITEM_ID, title: t('settingsSession.transcript.messageActions.messageMenu.copy'), icon: <Icon name="copy" size={18} /> },
        { id: SELECT_TEXT_ITEM_ID, title: t('settingsSession.transcript.messageActions.messageMenu.selectText'), icon: <Icon name="text-aa" size={18} /> },
    ], []);

    const { text } = props;
    const onSelect = React.useCallback((itemId: string) => {
        setOpen(false);
        if (itemId === COPY_ITEM_ID) {
            void setClipboardStringSafe(text).then((ok) => {
                if (!ok) Modal.alert(t('common.error'), t('items.failedToCopyToClipboard'));
            });
            return;
        }
        if (itemId === SELECT_TEXT_ITEM_ID) {
            Modal.show({ component: SelectMessageTextModal, props: { text } });
        }
    }, [text]);

    return (
        <Pressable
            ref={anchorRef}
            testID={`transcript-user-message-long-press:${props.messageId}`}
            style={props.style}
            onLongPress={hasText ? () => setOpen(true) : undefined}
            accessibilityActions={hasText ? [{ name: 'longpress', label: t('settingsSession.transcript.messageActions.messageMenu.copy') }] : undefined}
            onAccessibilityAction={hasText ? (event) => {
                if (event.nativeEvent.actionName === 'longpress') setOpen(true);
            } : undefined}
        >
            {props.children}
            {open ? (
                <ContextMenu
                    open={open}
                    onOpenChange={setOpen}
                    anchorRef={anchorRef}
                    items={items}
                    onSelect={onSelect}
                    placement="auto"
                    variant="slim"
                    showCategoryTitles={false}
                    maxWidthCap={260}
                />
            ) : null}
        </Pressable>
    );
}

type SelectMessageTextModalProps = CustomModalInjectedProps & Readonly<{ text: string }>;

function SelectMessageTextModal(props: SelectMessageTextModalProps) {
    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title: t('settingsSession.transcript.messageActions.messageMenu.selectText'),
        testID: 'transcript-select-message-text-modal',
        closeButtonTestID: 'transcript-select-message-text-close',
        bodyScroll: 'auto' as const,
        dimensions: { width: 520, maxHeightRatio: 0.85, size: 'dialog' as const },
    }), []);
    useModalCardChrome(props.setChrome, chrome);

    return (
        <View style={styles.body}>
            <Text selectable style={styles.text} testID="transcript-select-message-text">{props.text}</Text>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    body: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    text: {
        color: theme.colors.text.primary,
        fontSize: 16,
        lineHeight: 23,
        ...Typography.default(),
    },
}));
