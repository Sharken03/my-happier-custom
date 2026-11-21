import type {
  AcpSessionModelAdapter,
  SessionConfigOption,
  SessionModel,
  SessionModelState,
} from '@/agent/acp/AcpBackend';

const REASONING_EFFORT_OPTION_ID = 'reasoning_effort';

// `agy acp` (1.5.3) lists a model with thinking levels once per level: id `<base>-<level>` and
// name `<Base> (<Level>)`, e.g. gemini-3.8-flash-low "Gemini 3.8 Flash (Low)". Its own `model`
// config option names the base id, so the base is what the composer shows and selects.
const LEVEL_SUFFIX = /^(.*)-(low|medium|high)$/;
const LEVELS = ['low', 'medium', 'high'] as const;
type Level = typeof LEVELS[number];

function levelName(level: Level): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function splitVariant(model: Readonly<SessionModel>): Readonly<{ base: string; baseName: string; level: Level }> | null {
  const match = LEVEL_SUFFIX.exec(model.id);
  if (!match) return null;
  const level = match[2] as Level;
  const nameSuffix = ` (${levelName(level)})`;
  if (!model.name.endsWith(nameSuffix)) return null;
  return { base: match[1]!, baseName: model.name.slice(0, -nameSuffix.length), level };
}

function effortOption(levels: ReadonlyArray<Level>, current: Level): SessionConfigOption {
  return {
    id: REASONING_EFFORT_OPTION_ID,
    name: 'Reasoning effort',
    type: 'select',
    currentValue: current,
    options: LEVELS.filter((level) => levels.includes(level)).map((level) => ({ value: level, name: levelName(level) })),
  };
}

function baseModelId(modelId: string, modelState: Readonly<SessionModelState> | null): string {
  const match = LEVEL_SUFFIX.exec(modelId);
  if (!match) return modelId;
  const base = match[1]!;
  return modelState?.availableModels.some((model) => model.id === base) ? base : modelId;
}

function currentEffort(model: Readonly<SessionModel> | undefined): Level | null {
  const value = model?.modelOptions?.find((option) => option.id === REASONING_EFFORT_OPTION_ID)?.currentValue;
  return LEVELS.find((level) => level === value) ?? null;
}

export const agySessionModelAdapter: AcpSessionModelAdapter = {
  projectModelState: ({ normalizedModelState }) => {
    const variants = new Map<string, { baseName: string; levels: Level[]; index: number }>();
    const models: SessionModel[] = [];
    const currentVariant = normalizedModelState.availableModels.find((model) => model.id === normalizedModelState.currentModelId);
    const currentSplit = currentVariant ? splitVariant(currentVariant) : null;
    for (const model of normalizedModelState.availableModels) {
      const split = splitVariant(model);
      if (!split) {
        models.push(model);
        continue;
      }
      const group = variants.get(split.base);
      if (group) {
        group.levels.push(split.level);
        continue;
      }
      variants.set(split.base, { baseName: split.baseName, levels: [split.level], index: models.length });
      models.push({ id: split.base, name: split.baseName });
    }
    for (const [base, group] of variants) {
      const current = currentSplit?.base === base ? currentSplit.level : group.levels.includes('high') ? 'high' : group.levels[0]!;
      models[group.index] = { id: base, name: group.baseName, modelOptions: [effortOption(group.levels, current)] };
    }
    return {
      currentModelId: currentSplit ? currentSplit.base : normalizedModelState.currentModelId,
      availableModels: models,
    };
  },
  projectModelId: ({ modelId, modelState }) => baseModelId(modelId, modelState),
  resolveModelUpdate: ({ modelId, modelState }) => {
    const model = modelState?.availableModels.find((entry) => entry.id === modelId);
    const level = currentEffort(model);
    return level ? { modelId: `${modelId}-${level}` } : undefined;
  },
  resolveConfigOptionModelUpdate: ({ configId, value, modelState }) => {
    if (configId !== REASONING_EFFORT_OPTION_ID) return undefined;
    const model = modelState?.availableModels.find((entry) => entry.id === modelState.currentModelId);
    const level = LEVELS.find((entry) => entry === value);
    if (!model || !level || !model.modelOptions?.some((option) => option.id === REASONING_EFFORT_OPTION_ID)) {
      throw new Error('Antigravity reasoning effort is not offered for the active model');
    }
    return { modelId: `${model.id}-${level}` };
  },
};
