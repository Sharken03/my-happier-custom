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
import { useSetting } from "@/sync/domains/state/storage";
import { sortModelPickerEntriesByLabel } from "@/sync/domains/models/modelPickerOrder";
import { t } from "@/text";

import { AgentInputSessionConfigOptionsSection } from "./AgentInputSessionConfigOptionsSection";

type AgentInputEngineModelOption = Readonly<{
  value: string;
  label: string;
  icon?: React.ReactNode;
  trailingStatusIcon?: React.ReactNode;
  accessibilityLabel?: string;
  description: string;
  costInputPerMTok?: number;
  costOutputPerMTok?: number;
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
  /** Callback to open the model picker as a bottom sheet */
  onOpenModelPickerBottomSheet?: () => void;
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
  alphabetical: boolean,
): ReadonlyArray<AgentInputEngineModelOption> {
  const favoriteOptions: AgentInputEngineModelOption[] = [];
  const otherOptions: AgentInputEngineModelOption[] = [];
  for (const option of options) {
    if (favoriteValues?.has(option.value)) {
      favoriteOptions.push(option);
    } else {
      otherOptions.push(option);
    }
  }

  if (alphabetical) {
    return [
      ...sortModelPickerEntriesByLabel(favoriteOptions, readModelOptionOrderKey),
      ...sortModelPickerEntriesByLabel(otherOptions, readModelOptionOrderKey),
    ];
  }
  if (favoriteOptions.length === 0) return options;
  return [...favoriteOptions, ...otherOptions];
}

function readModelOptionOrderKey(option: AgentInputEngineModelOption): Readonly<{ value: string; label: string }> {
  return { value: option.value, label: option.label };
}

export function AgentInputEngineDetail(props: AgentInputEngineDetailProps) {
  const compact = useSetting("agentInputCompactModelPicker") === true;
  const alphabetical = useSetting("agentInputModelPickerAlphabetical") === true;
  const presentation = useSetting("agentInputModelPickerLayout") === 'compact' ? 'compact' : 'carded';
  const favoriteModelValues = props.favoriteModelValues;
  const onToggleFavoriteModel = props.onToggleFavoriteModel;
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

    return orderFavoriteModelOptionsFirst(describedOptions, favoriteModelValues, alphabetical);
  }, [alphabetical, compact, favoriteModelValues, props.modelOptions]);

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
              presentation={presentation}
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
