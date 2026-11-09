import * as React from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  OptionPickerOverlay,
  type OptionPickerFavoriteOptions,
  type OptionPickerOption,
  type OptionPickerProbeState,
} from "@/components/sessions/pickers/OptionPickerOverlay";
import type {
  SessionConfigOption,
  SessionConfigOptionControl,
  SessionConfigOptionValueId,
} from "@/sync/domains/sessionControl/configOptionsControl";
import { useSetting, useSettingMutable } from "@/sync/domains/state/storage";
import { t } from "@/text";

import { AgentInputSessionConfigOptionsSection } from "./AgentInputSessionConfigOptionsSection";

type AgentInputEngineModelOption = Readonly<{
  value: string;
  label: string;
  icon?: React.ReactNode;
  trailingStatusIcon?: React.ReactNode;
  accessibilityLabel?: string;
  description: string;
  modelOptions?: ReadonlyArray<SessionConfigOption>;
}>;

type AgentInputEngineDetailProps = Readonly<{
  modelOptions?: ReadonlyArray<AgentInputEngineModelOption>;
  selectedModelId?: string;
  modelSummary?: React.ReactNode;
  modelNotes?: ReadonlyArray<string>;
  modelEmptyText?: string;
  canEnterCustomModel?: boolean;
  modelProbe?: OptionPickerProbeState;
  modelHeaderAccessory?: React.ReactNode;
  favoriteModelValues?: ReadonlySet<string>;
  /**
   * The agent whose favorite models (setting favoriteModels, "<scope>:<value>") the picker reads
   * and toggles when the host does not pass favoriteModelValues itself.
   */
  favoriteModelScope?: string;
  isModelFavoritable?: (option: AgentInputEngineModelOption) => boolean;
  onToggleFavoriteModel?: (option: AgentInputEngineModelOption) => void;
  onSelectModel?: (value: string) => void;
  onSubmitCustomValue?: (value: string) => void | Promise<void>;
  selectedModelOptionControls?: ReadonlyArray<SessionConfigOptionControl> | null;
  onSelectModelOptionValue?: (
    configId: string,
    valueId: SessionConfigOptionValueId,
  ) => void;

  configControls?: ReadonlyArray<SessionConfigOptionControl> | null;
  configProbe?: OptionPickerProbeState;
  onSelectConfigValue?: (
    configId: string,
    valueId: SessionConfigOptionValueId,
  ) => void;

  sectionOrder?: ReadonlyArray<"model" | "config">;
  surfaceVariant?: "carded" | "plain";
}>;

function wrapSection(
  variant: AgentInputEngineDetailProps["surfaceVariant"],
  key: string,
  content: React.ReactNode,
) {
  if (!content) return null;
  if (variant === "plain") {
    return <React.Fragment key={key}>{content}</React.Fragment>;
  }
  return (
    <View key={key} style={styles.sectionCard}>
      {content}
    </View>
  );
}

function orderFavoriteModelOptionsFirst(
  options: ReadonlyArray<AgentInputEngineModelOption>,
  favoriteValues: ReadonlySet<string> | null | undefined,
): ReadonlyArray<AgentInputEngineModelOption> {
  if (!favoriteValues || favoriteValues.size === 0) return options;

  const favoriteOptions: AgentInputEngineModelOption[] = [];
  const otherOptions: AgentInputEngineModelOption[] = [];
  for (const option of options) {
    if (favoriteValues.has(option.value)) {
      favoriteOptions.push(option);
    } else {
      otherOptions.push(option);
    }
  }

  if (favoriteOptions.length === 0) return options;
  return [...favoriteOptions, ...otherOptions];
}

const NO_FAVORITE_MODELS: readonly string[] = [];

/** The favorite model values of one agent, from the setting's "<scope>:<value>" keys. */
export function favoriteModelValuesForScope(keys: readonly string[], scope: string): ReadonlySet<string> {
  const prefix = `${scope}:`;
  return new Set(keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)));
}

/** The setting's keys with one agent's model added or, when it was a favorite, removed. */
export function toggleFavoriteModelKey(keys: readonly string[], scope: string, value: string): string[] {
  const key = `${scope}:${value}`;
  return keys.includes(key) ? keys.filter((entry) => entry !== key) : [...keys, key];
}

export function AgentInputEngineDetail(props: AgentInputEngineDetailProps) {
  const [storedFavoriteModels, setFavoriteModels] = useSettingMutable("favoriteModels");
  const compact = useSetting("agentInputCompactModelPicker") === true;
  const favoriteModelKeys = storedFavoriteModels ?? NO_FAVORITE_MODELS;
  const scope = props.favoriteModelScope;
  const scopedFavoriteValues = React.useMemo<ReadonlySet<string> | undefined>(() => {
    if (!scope) return undefined;
    return favoriteModelValuesForScope(favoriteModelKeys, scope);
  }, [favoriteModelKeys, scope]);
  const favoriteModelValues = props.favoriteModelValues ?? scopedFavoriteValues;
  const onToggleFavoriteModel = props.onToggleFavoriteModel ?? (scope
    ? (option: AgentInputEngineModelOption) => {
        setFavoriteModels(toggleFavoriteModelKey(favoriteModelKeys, scope, option.value));
      }
    : undefined);
  // "Use CLI settings" is not a model.
  const isModelFavoritable = props.isModelFavoritable
    ?? ((option: AgentInputEngineModelOption) => option.value !== "default");
  const sectionOrder = props.sectionOrder ?? ["model", "config"];
  const surfaceVariant = props.surfaceVariant ?? "carded";
  const hasModelSection =
    (props.modelOptions?.length ?? 0) > 0 || props.canEnterCustomModel === true;
  const hasConfigSection = (props.configControls?.length ?? 0) > 0;

  if (!hasModelSection && !hasConfigSection) {
    return null;
  }

  const resolvedModelOptions = React.useMemo(() => {
    const options = compact
      ? (props.modelOptions ?? []).map((option) => ({ ...option, description: "" }))
      : props.modelOptions ?? [];
    const shouldShowDescriptions = options.some(
      (option) =>
        option.value !== "default" &&
        typeof option.description === "string" &&
        option.description.trim().length > 0,
    );

    const describedOptions = shouldShowDescriptions ? options.map((option) => {
      if (option.value !== "default") return option;
      if (typeof option.description === "string" && option.description.trim().length > 0) {
        return option;
      }
      return { ...option, description: t("agentInput.model.configureInCli") };
    }) : options;

    return orderFavoriteModelOptionsFirst(describedOptions, favoriteModelValues);
  }, [compact, favoriteModelValues, props.modelOptions]);

  const favoriteOptions = React.useMemo<OptionPickerFavoriteOptions | undefined>(() => {
    if (!onToggleFavoriteModel || !favoriteModelValues) {
      return undefined;
    }

    return {
      values: favoriteModelValues,
      isFavoritable: (option: OptionPickerOption) => isModelFavoritable(option as AgentInputEngineModelOption) === true,
      onToggle: (option: OptionPickerOption) => {
        onToggleFavoriteModel(option as AgentInputEngineModelOption);
      },
    };
  }, [
    favoriteModelValues,
    isModelFavoritable,
    onToggleFavoriteModel,
  ]);

  const sections: Record<"model" | "config", React.ReactNode | null> =
    {
      model: hasModelSection
        ? wrapSection(
            surfaceVariant,
            "model",
            <OptionPickerOverlay
              title={t("agentInput.model.title")}
              summary={compact ? undefined : props.modelSummary}
              notes={props.modelProbe?.error
                ? [...(compact ? [] : props.modelNotes ?? []), t("errors.unknownError")]
                : compact ? [] : props.modelNotes ?? []}
              options={resolvedModelOptions}
              selectedValue={props.selectedModelId ?? "default"}
              emptyText={
                props.modelEmptyText ?? t("agentInput.model.configureInCli")
              }
              canEnterCustomValue={props.canEnterCustomModel === true}
              customLabel={`${t("profiles.custom")}...`}
              customDescription={t("agentInput.model.customDescription")}
              favoriteOptions={favoriteOptions}
              headerAccessory={props.modelHeaderAccessory}
              probe={props.modelProbe}
              selectedOptionControls={props.selectedModelOptionControls ?? undefined}
              onSelectOptionControlValue={props.onSelectModelOptionValue}
              onSelect={props.onSelectModel ?? (() => {})}
              onSubmitCustomValue={props.onSubmitCustomValue}
            />,
          )
        : null,
      config: hasConfigSection
        ? wrapSection(
            surfaceVariant,
            "config",
            <View style={styles.configSection}>
              <AgentInputSessionConfigOptionsSection
                controls={props.configControls ?? []}
                onSelectValue={props.onSelectConfigValue}
              />
            </View>,
          )
        : null,
    };

  return (
    <View style={styles.container}>
      {sectionOrder.map((sectionId) => sections[sectionId])}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: 10,
  },
  sectionCard: {
    overflow: "hidden",
  },
  configSection: {
    gap: 8,
  },
}));
