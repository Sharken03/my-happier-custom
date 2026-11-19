import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    return {
        ...actual,
        Pressable: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
            React.createElement('Pressable', props, props.children),
    };
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown> & { rightElement?: React.ReactNode }) =>
        React.createElement('Item', props, props.rightElement),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: Record<string, unknown>) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/components/ui/rendering/normalizeNodeForView', () => ({
    normalizeNodeForView: (node: React.ReactNode) => node,
}));

const codexEntry = {
    targetKey: 'agent:codex',
    title: 'Codex',
    providerAgentId: 'codex',
    builtInAgentId: 'codex',
    target: { kind: 'builtInAgent', agentId: 'codex' },
};

describe('NewSessionModelSelectionContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders favorite models first and does not duplicate them in all models', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                modelOptions={[
                    { value: 'default', label: 'Default', description: 'Use CLI settings' },
                    { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Fast' },
                    { value: 'gpt-5.5', label: 'GPT-5.5', description: 'Deep' },
                ]}
                selectedModelId="gpt-5.4"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[
                    {
                        backendTargetKey: 'agent:codex',
                        providerAgentId: 'codex',
                        builtInAgentId: 'codex',
                        configuredBackendId: null,
                        modelId: 'gpt-5.5',
                        modelLabel: 'GPT-5.5',
                        backendLabel: 'Codex',
                        addedAtMs: 1,
                    },
                ]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={vi.fn()}
            />,
        );

        const groups = screen.findAllByType('ItemGroup' as any);
        expect(groups.map((group) => group.props.title)).toEqual(['Favorites', 'All']);

        const items = screen.findAllByType('Item' as any);
        expect(items.filter((item) => item.props.testID === 'new-session-model:gpt-5.5')).toHaveLength(1);
        expect(items.filter((item) => item.props.testID === 'new-session-model:gpt-5.4')).toHaveLength(1);
    });

    it('shows the price level in a fixed column and hides it for free and unpriced models', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                modelOptions={[
                    { value: 'paid-model', label: 'Paid', description: 'Mid tier', costInputPerMTok: 2, costOutputPerMTok: 6 },
                    { value: 'free-model', label: 'Free', description: 'No charge', costInputPerMTok: 0, costOutputPerMTok: 0 },
                    { value: 'unpriced-model', label: 'Unpriced', description: 'No catalog price' },
                ]}
                selectedModelId="paid-model"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                onSelectModel={vi.fn()}
            />,
        );

        const priceTexts = screen.findAllByType('Text' as any)
            .map((node) => node.props.children)
            .filter((child) => typeof child === 'string' && /^\$+$/.test(child));
        expect(priceTexts).toEqual(['$$$']);

        // Free and unpriced rows still render their column, so the star and the check mark
        // never move; they simply have no symbol in it.
        const priceColumns = screen.findAllByType('View' as any)
            .filter((node) => node.props.style && Number(node.props.style.width) === 44);
        expect(priceColumns).toHaveLength(3);
    });

    it('announces a price level instead of the dollar signs', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                modelOptions={[
                    { value: 'paid-model', label: 'Paid', description: 'Mid tier', costInputPerMTok: 2, costOutputPerMTok: 6 },
                    { value: 'free-model', label: 'Free', description: 'No charge', costInputPerMTok: 0, costOutputPerMTok: 0 },
                    { value: 'unpriced-model', label: 'Unpriced', description: 'No catalog price' },
                ]}
                selectedModelId="paid-model"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                onSelectModel={vi.fn()}
            />,
        );

        const labels = screen.findAllByType('View' as any)
            .map((node) => node.props.accessibilityLabel)
            .filter((label) => typeof label === 'string');
        expect(labels).toEqual(['Cost: 3/4']);
    });

    it('shows the price level in the compact dropdown too', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                presentation="compact"
                modelOptions={[
                    { value: 'paid-model', label: 'Paid', description: 'Mid tier', costInputPerMTok: 8, costOutputPerMTok: 40 },
                ]}
                selectedModelId="paid-model"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                onSelectModel={vi.fn()}
            />,
        );

        // The double does not mount dropdown items, so the row element is checked for the
        // price it will render; the rendering itself is pinned by the expanded-list case.
        const dropdown = screen.findByType('DropdownMenu' as any);
        expect(dropdown.props.items[0]?.rightElement?.props?.model).toMatchObject({
            id: 'paid-model',
            costInputPerMTok: 8,
            costOutputPerMTok: 40,
        });
    });

    it('keeps stale favorite models removable without making them selectable', async () => {
        const onFavoriteModelSelectionsChange = vi.fn();
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                modelOptions={[
                    { value: 'default', label: 'Default', description: 'Use CLI settings' },
                ]}
                selectedModelId="default"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[
                    {
                        backendTargetKey: 'agent:codex',
                        providerAgentId: 'codex',
                        builtInAgentId: 'codex',
                        configuredBackendId: null,
                        modelId: 'retired-model',
                        modelLabel: 'Retired model',
                        backendLabel: 'Codex',
                        addedAtMs: 1,
                    },
                ]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={onFavoriteModelSelectionsChange}
            />,
        );

        const staleRows = screen.findAllByType('Item' as any).filter((item) => item.props.testID === 'new-session-model:retired-model');
        expect(staleRows).toHaveLength(1);
        expect(staleRows[0]?.props.disabled).toBe(true);

        const rightElement = staleRows[0]?.props.rightElement;
        expect(typeof rightElement?.props?.onToggleFavorite).toBe('function');
        rightElement?.props?.onToggleFavorite();

        expect(onFavoriteModelSelectionsChange).toHaveBeenCalledWith([]);
    });

    it('keeps favorite models grouped first in compact dropdown mode', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                presentation="compact"
                modelOptions={[
                    { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Fast' },
                    { value: 'gpt-5.5', label: 'GPT-5.5', description: 'Deep' },
                ]}
                selectedModelId="gpt-5.4"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[
                    {
                        backendTargetKey: 'agent:codex',
                        providerAgentId: 'codex',
                        builtInAgentId: 'codex',
                        configuredBackendId: null,
                        modelId: 'gpt-5.5',
                        modelLabel: 'GPT-5.5',
                        backendLabel: 'Codex',
                        addedAtMs: 1,
                    },
                ]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={vi.fn()}
            />,
        );

        const menu = screen.root.findByType('DropdownMenu' as any);
        expect(menu.props.items.map((item: any) => [item.id, item.category])).toEqual([
            ['gpt-5.5', 'Favorites'],
            ['gpt-5.4', 'All'],
        ]);
        expect(menu.props.search).toBe(true);
        expect(screen.findAllByType('ItemGroup' as any)).toHaveLength(1);
    });

    it('wires compact dropdown favorite actions to the model favorites setting', async () => {
        const onFavoriteModelSelectionsChange = vi.fn();
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                presentation="compact"
                modelOptions={[
                    { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Fast' },
                ]}
                selectedModelId="gpt-5.4"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={onFavoriteModelSelectionsChange}
            />,
        );

        // The compact row keeps a price column, so the favorite action lives inside the
        // row's rightElement rather than being the rightElement itself. The DropdownMenu
        // double does not mount its items, so the action is read from the element tree.
        const compactMenu = screen.root.findByType('DropdownMenu' as any);
        const favoriteControl = compactMenu.props.items[0]?.rightElement?.props?.favoriteAction;
        expect(favoriteControl?.props?.disabled).toBe(false);

        favoriteControl?.props?.onPress?.({ stopPropagation: vi.fn() });

        expect(onFavoriteModelSelectionsChange).toHaveBeenCalledWith([
            expect.objectContaining({
                backendTargetKey: 'agent:codex',
                providerAgentId: 'codex',
                builtInAgentId: 'codex',
                modelId: 'gpt-5.4',
                modelLabel: 'GPT-5.4',
                backendLabel: 'Codex',
            }),
        ]);
    });

    it('disables the compact favorite action when no change handler can record it', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                presentation="compact"
                modelOptions={[{ value: 'gpt-5.5', label: 'GPT-5.5', description: 'Deep' }]}
                selectedModelId="gpt-5.5"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[
                    {
                        backendTargetKey: 'agent:codex',
                        providerAgentId: 'codex',
                        builtInAgentId: 'codex',
                        configuredBackendId: null,
                        modelId: 'gpt-5.5',
                        modelLabel: 'GPT-5.5',
                        backendLabel: 'Codex',
                        addedAtMs: 1,
                    },
                ]}
                onSelectModel={vi.fn()}
            />,
        );

        // The favorites-category row and the all-models row must agree: no handler, no action.
        const menu = screen.root.findByType('DropdownMenu' as any);
        expect(menu.props.items[0]?.category).toBe('Favorites');
        expect(menu.props.items[0]?.rightElement?.props?.favoriteAction?.props?.disabled).toBe(true);
    });

    it('does not render favorite actions for the CLI settings model in list or dropdown mode', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const expanded = await renderScreen(
            <NewSessionModelSelectionContent
                modelOptions={[
                    { value: 'default', label: 'Use CLI settings', description: 'Use the model configured in the CLI' },
                ]}
                selectedModelId="default"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={vi.fn()}
            />,
        );

        expect(expanded.findAllByProps({ testID: 'new-session-model-favorite:default' })).toHaveLength(0);

        const compact = await renderScreen(
            <NewSessionModelSelectionContent
                presentation="compact"
                modelOptions={[
                    { value: 'default', label: 'Use CLI settings', description: 'Use the model configured in the CLI' },
                ]}
                selectedModelId="default"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={vi.fn()}
            />,
        );

        const menu = compact.root.findByType('DropdownMenu' as any);
        // A row without a favorite action still carries the price column, so the star's
        // absence is asserted on the action itself.
        expect(menu.props.items[0]?.rightElement?.props?.favoriteAction).toBeUndefined();
    });

    it('shows the selected model as the compact dropdown trigger subtitle', async () => {
        const { NewSessionModelSelectionContent } = await import('./NewSessionModelSelectionContent');

        const screen = await renderScreen(
            <NewSessionModelSelectionContent
                presentation="compact"
                modelOptions={[
                    { value: 'default', label: 'Use CLI settings', description: 'Use the model configured in the CLI' },
                    { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Fast' },
                ]}
                selectedModelId="default"
                selectedIndicatorColor="#0af"
                selectedBackendEntry={codexEntry as any}
                favoriteModelSelections={[]}
                onSelectModel={vi.fn()}
                onFavoriteModelSelectionsChange={vi.fn()}
            />,
        );

        const menu = screen.root.findByType('DropdownMenu' as any);
        expect(menu.props.itemTrigger.subtitle).toBe('Use CLI settings');
        expect(menu.props.itemTrigger.showSelectedDetail).toBe(false);
        expect(menu.props.itemTrigger.showSelectedSubtitle).toBe(false);
    });
});
