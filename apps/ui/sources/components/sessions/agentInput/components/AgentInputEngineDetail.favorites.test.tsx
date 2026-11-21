import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { AgentInputEngineDetail } from './AgentInputEngineDetail';
import { OptionPickerOverlay, type OptionPickerOption } from '@/components/sessions/pickers/OptionPickerOverlay';
import { installNewSessionComponentsCommonModuleMocks } from '@/components/sessions/new/components/newSessionComponentsTestHelpers';

installNewSessionComponentsCommonModuleMocks();

const MODEL_OPTIONS = [
    { value: 'default', label: 'Use CLI settings', description: '' },
    { value: 'model-a', label: 'Model A', description: 'first model' },
    { value: 'model-b', label: 'Model B', description: 'second model' },
] as const;

async function renderEngineDetail(params: Readonly<{
    favoriteModelValues?: ReadonlySet<string>;
    onToggleFavoriteModel?: (option: OptionPickerOption) => void;
}>) {
    return renderScreen(<AgentInputEngineDetail
        modelOptions={[...MODEL_OPTIONS]}
        selectedModelId="default"
        favoriteModelValues={params.favoriteModelValues}
        onToggleFavoriteModel={params.onToggleFavoriteModel}
        onSelectModel={() => {}}
    />);
}

describe('model favorites in a session composer', () => {
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
