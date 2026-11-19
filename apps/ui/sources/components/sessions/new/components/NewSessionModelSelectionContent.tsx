import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { ResolvedBackendCatalogEntry } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { normalizeNodeForView } from '@/components/ui/rendering/normalizeNodeForView';
import type { ModelMode } from '@/sync/domains/permissions/permissionTypes';
import {
    favoriteModelSelectionMatchesBackend,
    isFavoriteModelSelectableId,
    normalizeFavoriteModelId,
    toggleFavoriteModelSelection,
    type FavoriteModelBackendIdentity,
    type FavoriteModelSelectionV1,
} from '@/sync/domains/models/favoriteModelSelections';
import { readModelPriceDisplay } from '@/sync/domains/models/priceTier';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';

export type NewSessionModelOption = Readonly<{
    value: ModelMode;
    label: string;
    /** USD per million input tokens; the row's price level is derived from it. */
    costInputPerMTok?: number;
    /** USD per million output tokens; the row's price level is derived from it. */
    costOutputPerMTok?: number;
    description: string;
}>;

export type NewSessionModelSelectionContentProps = Readonly<{
    presentation?: 'expanded' | 'compact';
    modelOptions: readonly NewSessionModelOption[];
    selectedModelId: ModelMode | undefined;
    selectedIndicatorColor: string;
    selectedBackendEntry?: ResolvedBackendCatalogEntry | null;
    popoverBoundaryRef?: React.RefObject<any> | null;
    favoriteModelSelections?: readonly FavoriteModelSelectionV1[];
    onSelectModel: (modelId: ModelMode) => void;
    onFavoriteModelSelectionsChange?: (favorites: FavoriteModelSelectionV1[]) => void;
}>;

type ModelSelectionRow = Readonly<{
    id: string;
    title: string;
    subtitle: string;
    costInputPerMTok?: number;
    costOutputPerMTok?: number;
    available: boolean;
    favoritable: boolean;
    favorite: boolean;
    staleFavorite: FavoriteModelSelectionV1 | null;
}>;

function buildFavoriteBackendIdentity(entry: ResolvedBackendCatalogEntry): FavoriteModelBackendIdentity {
    return {
        backendTargetKey: entry.targetKey,
        providerAgentId: entry.providerAgentId,
        builtInAgentId: entry.builtInAgentId,
        configuredBackendId: entry.target.kind === 'configuredAcpBackend' ? entry.target.backendId : null,
    };
}

function buildRows(params: Readonly<{
    modelOptions: readonly NewSessionModelOption[];
    selectedBackendEntry?: ResolvedBackendCatalogEntry | null;
    favoriteModelSelections?: readonly FavoriteModelSelectionV1[];
}>): Readonly<{
    favoriteRows: readonly ModelSelectionRow[];
    allRows: readonly ModelSelectionRow[];
}> {
    const optionById = new Map<string, NewSessionModelOption>();
    for (const option of params.modelOptions) {
        const modelId = normalizeFavoriteModelId(option.value);
        if (!modelId || optionById.has(modelId)) continue;
        optionById.set(modelId, option);
    }

    const backendIdentity = params.selectedBackendEntry
        ? buildFavoriteBackendIdentity(params.selectedBackendEntry)
        : null;
    const matchingFavorites = backendIdentity
        ? (params.favoriteModelSelections ?? []).filter((favorite) => favoriteModelSelectionMatchesBackend(favorite, backendIdentity))
        : [];

    const favoriteIds = new Set<string>();
    const favoriteRows: ModelSelectionRow[] = [];
    for (const favorite of matchingFavorites) {
        const modelId = normalizeFavoriteModelId(favorite.modelId);
        if (!isFavoriteModelSelectableId(modelId) || favoriteIds.has(modelId)) continue;
        favoriteIds.add(modelId);
        const option = optionById.get(modelId) ?? null;
        favoriteRows.push({
            id: modelId,
            title: option?.label || favorite.modelLabel || modelId,
            subtitle: option?.description || favorite.backendLabel || t('agentInput.model.configureInCli'),
            ...(typeof option?.costInputPerMTok === 'number' ? { costInputPerMTok: option.costInputPerMTok } : {}),
            ...(typeof option?.costOutputPerMTok === 'number' ? { costOutputPerMTok: option.costOutputPerMTok } : {}),
            available: Boolean(option),
            favoritable: true,
            favorite: true,
            staleFavorite: option ? null : favorite,
        });
    }

    const allRows = params.modelOptions.flatMap((option): ModelSelectionRow[] => {
        const modelId = normalizeFavoriteModelId(option.value);
        if (!modelId || favoriteIds.has(modelId)) return [];
        return [{
            id: modelId,
            title: option.label,
            subtitle: option.description,
            ...(typeof option.costInputPerMTok === 'number' ? { costInputPerMTok: option.costInputPerMTok } : {}),
            ...(typeof option.costOutputPerMTok === 'number' ? { costOutputPerMTok: option.costOutputPerMTok } : {}),
            available: true,
            favoritable: isFavoriteModelSelectableId(modelId),
            favorite: false,
            staleFavorite: null,
        }];
    });

    return { favoriteRows, allRows };
}

function FavoriteToggle(props: Readonly<{
    model: ModelSelectionRow;
    disabled: boolean;
    selectedIndicatorColor: string;
    onPress: () => void;
}>) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            testID={`new-session-model-favorite:${props.model.id}`}
            accessibilityRole="button"
            accessibilityLabel={props.model.favorite ? t('profiles.actions.removeFromFavorites') : t('profiles.actions.addToFavorites')}
            disabled={props.disabled}
            onPress={(event) => {
                event.stopPropagation?.();
                props.onPress();
            }}
            style={styles.favoriteButton}
        >
            <Icon
                name="star"
                size={20}
                color={props.model.favorite ? props.selectedIndicatorColor : theme.colors.text.secondary}
                weight={props.model.favorite ? 'fill' : 'regular'}
            />
        </Pressable>
    );
}

function ModelPriceColumn(props: Readonly<{
    costInputPerMTok?: number;
    costOutputPerMTok?: number;
}>) {
    const { theme } = useUnistyles();
    const price = readModelPriceDisplay({
        costInputPerMTok: props.costInputPerMTok,
        costOutputPerMTok: props.costOutputPerMTok,
    });
    const label = price.accessibilityLabel ?? undefined;
    return (
        <View
            style={styles.priceColumn}
            accessible={label !== undefined}
            accessibilityRole={label !== undefined ? 'text' : undefined}
            accessibilityLabel={label}
            accessibilityElementsHidden={label === undefined}
            importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'auto'}
        >
            {price.symbol === null ? null : (
                <Text style={[styles.priceText, { color: theme.colors.text.secondary }]}>{price.symbol}</Text>
            )}
        </View>
    );
}

function ModelRightElement(props: Readonly<{
    model: ModelSelectionRow;
    selected: boolean;
    selectedIndicatorColor: string;
    favoritesEnabled: boolean;
    showFavoriteAction: boolean;
    onToggleFavorite: () => void;
}>) {
    return (
        <View style={styles.rightElement}>
            {/* Fixed-width column, right-aligned: the star and the check mark must not move
                between rows. Free and unknown prices render nothing at all. */}
            <ModelPriceColumn
                costInputPerMTok={props.model.costInputPerMTok}
                costOutputPerMTok={props.model.costOutputPerMTok}
            />
            {props.showFavoriteAction ? (
                <FavoriteToggle
                    model={props.model}
                    disabled={!props.favoritesEnabled}
                    selectedIndicatorColor={props.selectedIndicatorColor}
                    onPress={props.onToggleFavorite}
                />
            ) : null}
            <Icon
                name="check-circle"
                size={24}
                color={props.selectedIndicatorColor}
                style={{ opacity: props.selected ? 1 : 0 }}
            />
        </View>
    );
}

function CompactRowRightElement(props: Readonly<{
    model: ModelSelectionRow;
    favoriteAction?: React.ReactNode;
}>) {
    return (
        <View style={styles.rightElement}>
            <ModelPriceColumn
                costInputPerMTok={props.model.costInputPerMTok}
                costOutputPerMTok={props.model.costOutputPerMTok}
            />
            {props.favoriteAction ?? null}
        </View>
    );
}

export function NewSessionModelSelectionContent(props: NewSessionModelSelectionContentProps) {
    const { theme } = useUnistyles();
    const [dropdownOpen, setDropdownOpen] = React.useState(false);

    const rows = React.useMemo(() => buildRows({
        modelOptions: props.modelOptions,
        selectedBackendEntry: props.selectedBackendEntry,
        favoriteModelSelections: props.favoriteModelSelections,
    }), [
        props.favoriteModelSelections,
        props.modelOptions,
        props.selectedBackendEntry,
    ]);

    const selectedModelId = normalizeFavoriteModelId(props.selectedModelId);
    const selectedRow = React.useMemo(() => {
        const allRows = [...rows.favoriteRows, ...rows.allRows];
        return allRows.find((row) => row.id === selectedModelId) ?? null;
    }, [rows.allRows, rows.favoriteRows, selectedModelId]);

    const toggleFavorite = React.useCallback((row: ModelSelectionRow) => {
        if (!props.selectedBackendEntry || !props.onFavoriteModelSelectionsChange) return;
        if (row.staleFavorite) {
            props.onFavoriteModelSelectionsChange(
                (props.favoriteModelSelections ?? []).filter((favorite) => favorite !== row.staleFavorite),
            );
            return;
        }
        props.onFavoriteModelSelectionsChange(toggleFavoriteModelSelection({
            favorites: props.favoriteModelSelections ?? [],
            backend: buildFavoriteBackendIdentity(props.selectedBackendEntry),
            modelId: row.id,
            modelLabel: row.title,
            backendLabel: props.selectedBackendEntry.title,
            addedAtMs: Date.now(),
        }));
    }, [
        props.favoriteModelSelections,
        props.onFavoriteModelSelectionsChange,
        props.selectedBackendEntry,
    ]);

    const renderRow = React.useCallback((row: ModelSelectionRow, index: number, list: readonly ModelSelectionRow[]) => {
        const selected = selectedModelId === row.id;
        return (
            <Item
                key={row.id}
                testID={`new-session-model:${row.id}`}
                title={row.title}
                subtitle={row.subtitle}
                leftElement={normalizeNodeForView(
                    <Icon name="sparkle" size={24} color={theme.colors.text.secondary} />,
                )}
                showChevron={false}
                selected={selected}
                disabled={!row.available}
                onPress={() => {
                    if (!row.available) return;
                    props.onSelectModel(row.id as ModelMode);
                }}
                rightElement={(
                    <ModelRightElement
                        model={row}
                        selected={selected}
                        selectedIndicatorColor={props.selectedIndicatorColor}
                        favoritesEnabled={Boolean(props.selectedBackendEntry && props.onFavoriteModelSelectionsChange)}
                        showFavoriteAction={row.favoritable}
                        onToggleFavorite={() => toggleFavorite(row)}
                    />
                )}
                showDivider={index < list.length - 1}
            />
        );
    }, [
        props.onFavoriteModelSelectionsChange,
        props.onSelectModel,
        props.selectedBackendEntry,
        props.selectedIndicatorColor,
        selectedModelId,
        theme.colors.text.secondary,
        toggleFavorite,
    ]);

    if (props.presentation === 'compact') {
        // Both compact builds must agree: a star that cannot record a favorite is disabled,
        // so the row never offers an action that silently does nothing.
        const favoritesDisabled = !props.selectedBackendEntry || !props.onFavoriteModelSelectionsChange;
        const dropdownItems: DropdownMenuItem[] = [
            ...rows.favoriteRows.map((row) => ({
                id: row.id,
                title: row.title,
                subtitle: row.subtitle,
                category: t('profiles.groups.favorites'),
                disabled: !row.available,
                icon: normalizeNodeForView(<Icon name="sparkle" size={20} color={theme.colors.text.secondary} />),
                rightElement: (
                    <CompactRowRightElement
                        model={row}
                        favoriteAction={row.favoritable ? (
                            <FavoriteToggle
                                model={row}
                                disabled={favoritesDisabled}
                                selectedIndicatorColor={props.selectedIndicatorColor}
                                onPress={() => toggleFavorite(row)}
                            />
                        ) : undefined}
                    />
                ),
            })),
            ...rows.allRows.map((row) => ({
                id: row.id,
                title: row.title,
                subtitle: row.subtitle,
                category: t('common.all'),
                disabled: !row.available,
                icon: normalizeNodeForView(<Icon name="sparkle" size={20} color={theme.colors.text.secondary} />),
                rightElement: (
                    <CompactRowRightElement
                        model={row}
                        favoriteAction={row.favoritable ? (
                            <FavoriteToggle
                                model={row}
                                disabled={favoritesDisabled}
                                selectedIndicatorColor={props.selectedIndicatorColor}
                                onPress={() => toggleFavorite(row)}
                            />
                        ) : undefined}
                    />
                ),
            })),
        ];
        return (
            <ItemGroup title="">
                <DropdownMenu
                    open={dropdownOpen}
                    onOpenChange={setDropdownOpen}
                    items={dropdownItems}
                    selectedId={selectedModelId}
                    onSelect={(id) => props.onSelectModel(id as ModelMode)}
                    rowKind="item"
                    variant="selectable"
                    search={true}
                    searchPlaceholder={t('modelPickerOverlay.searchPlaceholder')}
                    showCategoryTitles={rows.favoriteRows.length > 0}
                    matchTriggerWidth
                    connectToTrigger
                    popoverBoundaryRef={props.popoverBoundaryRef}
                    itemTrigger={{
                        title: t('newSession.selectModelTitle'),
                        subtitle: selectedRow?.title ?? t('newSession.selectModelDescription'),
                        showSelectedDetail: false,
                        showSelectedSubtitle: false,
                        icon: normalizeNodeForView(<Icon name="sparkle" size={24} color={theme.colors.text.secondary} />),
                        itemProps: {
                            testID: 'new-session-model-dropdown-trigger',
                        },
                    }}
                />
            </ItemGroup>
        );
    }

    return (
        <>
            {rows.favoriteRows.length > 0 ? (
                <ItemGroup title={t('profiles.groups.favorites')}>
                    {rows.favoriteRows.map(renderRow)}
                </ItemGroup>
            ) : null}
            <ItemGroup title={rows.favoriteRows.length > 0 ? t('common.all') : ''}>
                {rows.allRows.map(renderRow)}
            </ItemGroup>
        </>
    );
}

const styles = StyleSheet.create(() => ({
    priceColumn: {
        width: 44,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    priceText: {
        fontFamily: 'monospace',
        fontSize: 13,
        letterSpacing: 0.5,
    },
    rightElement: {
        minWidth: 60,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
    },
    favoriteButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
