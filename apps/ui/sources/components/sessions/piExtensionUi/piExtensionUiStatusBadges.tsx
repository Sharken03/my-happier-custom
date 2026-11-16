import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { AgentInputStatusBadge } from '@/components/sessions/agentInput/agentInputContracts';
import { AgentInputContentPopover } from '@/components/sessions/agentInput/components/AgentInputContentPopover';
import { Icon } from '@/components/ui/icons/Icon';
import { Typography } from '@/constants/Typography';
import { Text } from '@/components/ui/text/Text';

/**
 * Pi extensions set status texts and widget lines (`ctx.ui.setStatus/setWidget`). The CLI saves
 * them in session metadata under `piExtensionUiV1` (apps/cli/src/backends/pi/rpc/piExtensionDisplayState.ts).
 * This module turns that value into composer status badges.
 */
export const PI_EXTENSION_UI_METADATA_KEY = 'piExtensionUiV1';

type PiExtensionUiEntry = Readonly<{ key: string; text: string; lines: readonly string[] }>;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Reads the snapshot from session metadata. The value keeps its identity while it does not change. */
export function readPiExtensionUiSnapshot(metadata: unknown): unknown {
    return asRecord(metadata)?.[PI_EXTENSION_UI_METADATA_KEY];
}

/** Returns one entry per status. A widget goes to the status whose key starts its key, else to the first. */
export function readPiExtensionUiEntries(value: unknown): PiExtensionUiEntry[] {
    const snapshot = asRecord(value);
    if (snapshot?.v !== 1) return [];
    const statuses = (Array.isArray(snapshot.statuses) ? snapshot.statuses : [])
        .map(asRecord)
        .filter((s): s is Record<string, unknown> => typeof s?.key === 'string' && typeof s.text === 'string' && s.text.length > 0)
        .map((s) => ({ key: s.key as string, text: s.text as string, lines: [] as string[] }));
    const widgets = (Array.isArray(snapshot.widgets) ? snapshot.widgets : [])
        .map(asRecord)
        .filter((w): w is Record<string, unknown> => typeof w?.key === 'string' && Array.isArray(w.lines));
    if (statuses.length === 0 && widgets.length > 0) statuses.push({ key: 'pi', text: 'Pi', lines: [] });
    for (const widget of widgets) {
        const owner = statuses.find((s) => (widget.key as string).startsWith(s.key)) ?? statuses[0];
        owner?.lines.push(...(widget.lines as unknown[]).filter((line): line is string => typeof line === 'string'));
    }
    return statuses;
}

export function buildPiExtensionUiStatusBadges(snapshot: unknown): AgentInputStatusBadge[] {
    return readPiExtensionUiEntries(snapshot).map((entry) => ({
        key: `pi-ext:${entry.key}`,
        label: entry.text,
        testID: `pi-extension-status-${entry.key}`,
        tone: 'active',
        emphasis: 'quiet',
        icon: (tint: string) => <Icon name="list" size={14} color={tint} />,
        ...(entry.lines.length > 0
            ? {
                renderPopover: ({ open, anchorRef, onRequestClose }) => (
                    <AgentInputContentPopover
                        open={open}
                        anchorRef={anchorRef}
                        onRequestClose={onRequestClose}
                        maxWidthCap={420}
                        maxHeightCap={420}
                        testID={`pi-extension-status-popover-${entry.key}`}
                        content={<PiExtensionUiLines lines={entry.lines} />}
                    />
                ),
            } satisfies Pick<AgentInputStatusBadge, 'renderPopover'>
            : {}),
    }));
}

function PiExtensionUiLines(props: Readonly<{ lines: readonly string[] }>) {
    const styles = stylesheet;
    return (
        <View style={styles.content}>
            {props.lines.map((line, index) => (
                <Text key={index} style={styles.line}>{line}</Text>
            ))}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    content: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 6,
    },
    line: {
        fontSize: 13,
        color: theme.colors.text.primary,
        ...Typography.default(),
    },
}));
