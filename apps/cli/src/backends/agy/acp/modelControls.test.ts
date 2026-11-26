import { describe, expect, it } from 'vitest';

import type { SessionModelState } from '@/agent/acp/AcpBackend';

import { agySessionModelAdapter } from './modelControls';

// The models of `agy acp` 1.5.3 session/new: Gemini 3.8 Flash comes as one model per thinking level.
const AGY_MODELS: SessionModelState = {
  currentModelId: 'gemini-3.8-flash-low',
  availableModels: [
    { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
  ],
};

function project(state: SessionModelState = AGY_MODELS): SessionModelState {
  return agySessionModelAdapter.projectModelState!({ normalizedModelState: state });
}

describe('agy session models', () => {
  it('shows the thinking-level variants as one model with a reasoning effort choice', () => {
    const state = project();
    expect(state.currentModelId).toBe('gemini-3.8-flash');
    expect(state.availableModels.map((model) => [model.id, model.name])).toEqual([
      ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
      ['claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)'],
    ]);
    const effort = state.availableModels[0]!.modelOptions?.find((option) => option.id === 'reasoning_effort');
    expect(effort?.currentValue).toBe('low');
    expect(effort?.options?.map((option) => option.value)).toEqual(['low', 'medium', 'high']);
  });

  it('sets the variant of the chosen effort, and keeps the effort when the model is picked again', () => {
    const state = project();
    expect(agySessionModelAdapter.resolveConfigOptionModelUpdate!({ configId: 'reasoning_effort', value: 'high', modelState: state }))
      .toEqual({ modelId: 'gemini-3.8-flash-high' });
    expect(agySessionModelAdapter.resolveModelUpdate!({ modelId: 'gemini-3.8-flash', modelState: state }))
      .toEqual({ modelId: 'gemini-3.8-flash-low' });
    expect(agySessionModelAdapter.resolveModelUpdate!({ modelId: 'claude-sonnet-4-6', modelState: state })).toBeUndefined();
    expect(agySessionModelAdapter.projectModelId!({ modelId: 'gemini-3.8-flash-medium', modelState: state }))
      .toBe('gemini-3.8-flash');
  });
});
