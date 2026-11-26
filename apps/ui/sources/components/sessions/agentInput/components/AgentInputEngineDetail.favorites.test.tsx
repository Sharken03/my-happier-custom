import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { OptionPickerOption } from '@/components/sessions/pickers/OptionPickerOverlay';
import { installNewSessionComponentsCommonModuleMocks } from '@/components/sessions/new/components/newSessionComponentsTestHelpers';

const settingValues = vi.hoisted(() => ({ agentInputModelPickerAlphabetical: false }));

installNewSessionComponentsCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub, createUseSettingMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSetting: createUseSettingMock({ values: settingValues }),
        });
    },
});

// Imported after the mocks are installed, so the components read the stubbed settings.
const { AgentInputEngineDetail } = await import('./AgentInputEngineDetail');
const { OptionPickerOverlay } = await import('@/components/sessions/pickers/OptionPickerOverlay');

const MODEL_OPTIONS = [
    { value: 'default', label: 'Use CLI settings', description: '' },
    { value: 'model-a', label: 'Model A', description: 'first model' },
    { value: 'model-b', label: 'Model B', description: 'second model' },
] as const;

async function renderEngineDetail(params: Readonly<{
    favoriteModelValues?: ReadonlySet<string>;
    onToggleFavoriteModel?: (option: OptionPickerOption) => void;
    modelOptions?: readonly Readonly<{ value: string; label: string; description: string }>[];
}>) {
    return renderScreen(<AgentInputEngineDetail
        modelOptions={[...(params.modelOptions ?? MODEL_OPTIONS)]}
        selectedModelId="default"
        favoriteModelValues={params.favoriteModelValues}
        onToggleFavoriteModel={params.onToggleFavoriteModel}
        onSelectModel={() => {}}
    />);
}

afterEach(() => {
    settingValues.agentInputModelPickerAlphabetical = false;
});

describe('model favorites in a session composer', () => {
    it('sorts favorites and the other models by name when the alphabetical setting is on', async () => {
        settingValues.agentInputModelPickerAlphabetical = true;
        const screen = await renderEngineDetail({
            modelOptions: [
                { value: 'default', label: 'Use CLI settings', description: '' },
                { value: 'z', label: 'Zeta 10', description: '' },
                { value: 'g10', label: 'GPT 6.10', description: '' },
                { value: 'a', label: 'alpha', description: '' },
                { value: 'g2', label: 'GPT 6.2', description: '' },
                { value: 'b', label: 'Beta', description: '' },
            ],
            favoriteModelValues: new Set(['z', 'b']),
            onToggleFavoriteModel: vi.fn(),
        });

        const overlay = screen.findByType(OptionPickerOverlay);
        expect(overlay.props.options.map((option: OptionPickerOption) => option.value))
            .toEqual(['b', 'z', 'default', 'a', 'g2', 'g10']);
    });

    it('lists the favorites the Session\'s backend stars first, keeping the rest in order', async () => {
        const screen = await renderEngineDetail({
            favoriteModelValues: new Set(['model-b']),
            onToggleFavoriteModel: vi.fn(),
        });

        const overlay = screen.findByType(OptionPickerOverlay);
        expect(overlay.props.options.map((option: OptionPickerOption) => option.value))
            .toEqual(['model-b', 'default', 'model-a']);
        expect([...overlay.props.favoriteOptions.values]).toEqual(['model-b']);
    });

    it('reports a star toggle through the caller\'s own favorites, not a picker-local setting', async () => {
        const onToggleFavoriteModel = vi.fn();
        const screen = await renderEngineDetail({
            favoriteModelValues: new Set(['model-b']),
            onToggleFavoriteModel,
        });

        const overlay = screen.findByType(OptionPickerOverlay);
        const modelA = overlay.props.options.find((option: OptionPickerOption) => option.value === 'model-a');
        await act(async () => {
            overlay.props.favoriteOptions.onToggle(modelA);
        });

        expect(onToggleFavoriteModel).toHaveBeenCalledWith(expect.objectContaining({ value: 'model-a' }));
    });

    it('offers no star at all when the host owns no favorites', async () => {
        const screen = await renderEngineDetail({});

        expect(screen.findByType(OptionPickerOverlay).props.favoriteOptions).toBeUndefined();
    });
});
