import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { normalizeMarkdownRemoteImageHosts, parseMarkdownRemoteImageHostsText } from '@/components/markdown/rendering/markdownRemoteImages';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { t } from '@/text';

function hostsToText(hosts: unknown): string {
    return normalizeMarkdownRemoteImageHosts(hosts).join('\n');
}

/**
 * Images in replies: the switch for images the agent shares with `show_image`, and markdown
 * images from allowed hosts with an on/off switch and the host list. The text field keeps
 * a local draft and saves the parsed hosts when it loses focus, so a half-typed host is not stored.
 */
export function TranscriptMarkdownImagesSettingsGroup() {
    const { theme } = useUnistyles();
    const [enabled, setEnabled] = useSettingMutable('transcriptMarkdownRemoteImagesEnabled');
    const [hosts, setHosts] = useSettingMutable('transcriptMarkdownRemoteImageHosts');
    const [sharedImagesEnabled, setSharedImagesEnabled] = useSettingMutable('transcriptSharedImagesEnabled');
    const savedText = hostsToText(hosts);
    const [draft, setDraft] = React.useState(savedText);

    React.useEffect(() => {
        setDraft(savedText);
    }, [savedText]);

    const commitDraft = React.useCallback(() => {
        const next = parseMarkdownRemoteImageHostsText(draft);
        setDraft(next.join('\n'));
        if (next.join('\n') !== savedText) setHosts(next);
    }, [draft, savedText, setHosts]);

    return (
        <ItemGroup
            title={t('settingsSession.transcript.markdownImages.groupTitle')}
            footer={t('settingsSession.transcript.markdownImages.groupFooter')}
        >
            <Item
                testID="settings-session-transcript-shared-images-enabled"
                title={t('settingsSession.transcript.markdownImages.sharedImages.title')}
                subtitle={t('settingsSession.transcript.markdownImages.sharedImages.subtitle')}
                rightElement={<Switch value={sharedImagesEnabled === true} onValueChange={setSharedImagesEnabled} />}
                showChevron={false}
                onPress={() => setSharedImagesEnabled(!(sharedImagesEnabled === true))}
            />
            <Item
                testID="settings-session-transcript-markdown-images-enabled"
                title={t('settingsSession.transcript.markdownImages.enabled.title')}
                subtitle={t('settingsSession.transcript.markdownImages.enabled.subtitle')}
                rightElement={<Switch value={enabled === true} onValueChange={setEnabled} />}
                showChevron={false}
                onPress={() => setEnabled(!(enabled === true))}
            />
            {enabled === true ? (
                <View testID="settings-session-transcript-markdown-images-hosts-field" style={styles.fieldContainer}>
                    <Text style={[styles.fieldLabel, { color: theme.colors.text.secondary }]}>
                        {t('settingsSession.transcript.markdownImages.hosts.title')}
                    </Text>
                    <Text style={[styles.fieldHint, { color: theme.colors.text.secondary }]}>
                        {t('settingsSession.transcript.markdownImages.hosts.subtitle')}
                    </Text>
                    <TextInput
                        testID="settings-session-transcript-markdown-images-hosts-input"
                        accessibilityLabel={t('settingsSession.transcript.markdownImages.hosts.title')}
                        value={draft}
                        onChangeText={setDraft}
                        onBlur={commitDraft}
                        placeholder="example.org"
                        placeholderTextColor={theme.colors.input.placeholder}
                        multiline
                        autoCorrect={false}
                        autoCapitalize="none"
                        keyboardType="url"
                        style={[
                            styles.textInput,
                            {
                                color: theme.colors.input.text,
                                backgroundColor: theme.colors.input.background,
                                borderColor: theme.colors.border.default,
                            },
                        ]}
                    />
                </View>
            ) : null}
        </ItemGroup>
    );
}

const styles = StyleSheet.create({
    fieldContainer: {
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 12,
    },
    fieldLabel: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        marginBottom: 4,
    },
    fieldHint: {
        ...Typography.default('regular'),
        fontSize: 12,
        marginBottom: 8,
    },
    textInput: {
        ...Typography.default('regular'),
        minHeight: 72,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        textAlignVertical: 'top',
    },
});
