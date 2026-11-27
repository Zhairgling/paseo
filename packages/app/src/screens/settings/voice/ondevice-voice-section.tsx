import { AppearanceText as Text } from "@/appearance/text";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Switch } from "@/components/ui/switch";
import {
  isOnDeviceAsrReady,
  resolveActiveOnDeviceTts,
  useOnDeviceSpeechStore,
  type SupertonicLang,
  type TtsEnginePreference,
} from "@/stores/ondevice-speech-store";
import { useOnDeviceLlmStore } from "@/stores/ondevice-llm-store";
import { ONDEVICE_LLM_CATALOG } from "@/composer/reprompt";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { stopReadAloud, toggleReadAloud, useReadAloud } from "@/utils/read-aloud";
import { Check, Download, Square, Trash2, Volume2, X } from "lucide-react-native";
import { Fragment, useCallback, useEffect } from "react";
import { Platform, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  OnDeviceModelId,
  PocketVoiceId,
  SupertonicVoiceId,
} from "../../../../modules/aju-ondevice-speech";
import type { OnDeviceLlmModelId } from "../../../../modules/aju-ondevice-llm";

const SAMPLE_PREVIEW_ID = "__ondevice_voice_preview__";
const SAMPLE_TEXT_FR =
  "Bonjour Julien ! Voici ta voix locale directement sur ton appareil, sans passer par un serveur.";
const SAMPLE_TEXT_EN = "Hello Julien! This voice runs completely locally on your Android device.";

const ThemedCheck = withUnistyles(Check, (theme: Theme) => ({
  color: theme.colors.accent,
}));

const POCKET_VOICES: ReadonlyArray<{ id: PocketVoiceId; label: string }> = [
  { id: "iris", label: "Iris" },
  { id: "julien", label: "Julien" },
  { id: "vald", label: "Vald" },
  { id: "estelle", label: "Estelle" },
  { id: "fabien", label: "Fabien" },
];

const SUPERTONIC_VOICES: readonly SupertonicVoiceId[] = [
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
];

const SUPERTONIC_LANGS: ReadonlyArray<{ id: SupertonicLang; label: string }> = [
  { id: "fr", label: "Français" },
  { id: "en", label: "English" },
  { id: "na", label: "Auto FR/EN" },
];

const ENGINE_OPTIONS: ReadonlyArray<{ id: TtsEnginePreference; label: string }> = [
  { id: "pocket-fr", label: "Pocket TTS FR" },
  { id: "supertonic-3", label: "Supertonic 3" },
  { id: "system", label: "Système" },
];

const SPEED_OPTIONS = [0.95, 1.0, 1.15, 1.3, 1.45] as const;

const REPROMPT_MODE_OPTIONS: ReadonlyArray<{ id: "enhance" | "fix"; label: string }> = [
  { id: "enhance", label: "Améliorer le prompt (recommandé)" },
  { id: "fix", label: "Nettoyer dictée seule" },
];

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} Mo`;
}

function buildAsrHint(asrReady: boolean, supported: boolean, totalRamMb: number): string {
  if (asrReady) {
    return "Actif hors-ligne — français, anglais et termes techniques";
  }
  if (supported) {
    return `RAM appareil : ${(totalRamMb / 1024).toFixed(1)} Go · Aucun serveur requis`;
  }
  return "Architecture ARM64 requise";
}

function OptionPill<T extends string | number>({
  value,
  label,
  selected,
  onSelect,
}: {
  value: T;
  label: string;
  selected: boolean;
  onSelect: (value: T) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(value);
  }, [onSelect, value]);

  return (
    <PressHighlight
      onPress={handlePress}
      style={[styles.pill, selected && styles.pillSelected]}
      accessibilityRole="button"
    >
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{label}</Text>
    </PressHighlight>
  );
}

function GenericModelDownloadCard({
  title,
  subtitle,
  expectedMb,
  installedBytes,
  isReady,
  isDownloading,
  progress,
  errorMsg,
  onDownload,
  onCancel,
  onDelete,
}: {
  title: string;
  subtitle: string;
  expectedMb: string;
  installedBytes?: number;
  isReady: boolean;
  isDownloading: boolean;
  progress?: { progress: number; message?: string };
  errorMsg?: string;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const pct = progress ? Math.round(progress.progress * 100) : 0;
  const sizeLabel = installedBytes ? formatMb(installedBytes) : expectedMb;

  return (
    <View style={styles.modelCard}>
      <View style={styles.modelHeader}>
        <View style={styles.modelTextWrap}>
          <Text style={settingsStyles.rowTitle}>{title}</Text>
          <Text style={settingsStyles.rowHint}>{subtitle}</Text>
        </View>
        {isReady ? (
          <View style={styles.readyBadge}>
            <ThemedCheck size={13} />
            <Text style={styles.readyBadgeText}>{sizeLabel}</Text>
          </View>
        ) : (
          <Text style={styles.sizeHint}>{expectedMb}</Text>
        )}
      </View>

      {isDownloading ? (
        <View style={styles.progressSection}>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${Math.max(4, pct)}%` }]} />
          </View>
          <View style={styles.progressRow}>
            <Text style={settingsStyles.rowHint}>
              {progress?.message ?? "Téléchargement…"} ({pct}%)
            </Text>
            <Button size="sm" variant="ghost" leftIcon={X} onPress={onCancel}>
              Annuler
            </Button>
          </View>
        </View>
      ) : (
        <View style={styles.actionsRow}>
          {isReady ? (
            <Button size="sm" variant="outline" leftIcon={Trash2} onPress={onDelete}>
              Supprimer
            </Button>
          ) : (
            <Button size="sm" variant="default" leftIcon={Download} onPress={onDownload}>
              {`Télécharger (${expectedMb})`}
            </Button>
          )}
        </View>
      )}

      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
    </View>
  );
}

function ModelDownloadCard({
  modelId,
  title,
  subtitle,
  expectedMb,
  onAfterInstall,
}: {
  modelId: OnDeviceModelId;
  title: string;
  subtitle: string;
  expectedMb: string;
  onAfterInstall?: () => void;
}) {
  const status = useOnDeviceSpeechStore((s) => s.statuses[modelId]);
  const progress = useOnDeviceSpeechStore((s) => s.progressByModel[modelId]);
  const errorMsg = useOnDeviceSpeechStore((s) => s.errorByModel[modelId]);
  const downloadModel = useOnDeviceSpeechStore((s) => s.downloadModel);
  const cancelDownload = useOnDeviceSpeechStore((s) => s.cancelDownload);
  const deleteModel = useOnDeviceSpeechStore((s) => s.deleteModel);

  const handleDownload = useCallback(() => {
    void downloadModel(modelId)
      .then((ok) => {
        if (ok) onAfterInstall?.();
        return ok;
      })
      .catch(() => false);
  }, [downloadModel, modelId, onAfterInstall]);

  const handleCancel = useCallback(() => {
    cancelDownload(modelId);
  }, [cancelDownload, modelId]);

  const handleDelete = useCallback(() => {
    void deleteModel(modelId);
  }, [deleteModel, modelId]);

  return (
    <GenericModelDownloadCard
      title={title}
      subtitle={subtitle}
      expectedMb={expectedMb}
      installedBytes={status?.installedBytes}
      isReady={Boolean(status?.ready)}
      isDownloading={status?.status === "downloading" || Boolean(progress)}
      progress={progress}
      errorMsg={errorMsg}
      onDownload={handleDownload}
      onCancel={handleCancel}
      onDelete={handleDelete}
    />
  );
}

function LlmModelDownloadCard({
  modelId,
  title,
  subtitle,
  expectedMb,
}: {
  modelId: OnDeviceLlmModelId;
  title: string;
  subtitle: string;
  expectedMb: string;
}) {
  const status = useOnDeviceLlmStore((s) => s.statuses[modelId]);
  const progress = useOnDeviceLlmStore((s) => s.progressByModel[modelId]);
  const errorMsg = useOnDeviceLlmStore((s) => s.errorByModel[modelId]);
  const downloadModel = useOnDeviceLlmStore((s) => s.downloadModel);
  const cancelDownload = useOnDeviceLlmStore((s) => s.cancelDownload);
  const deleteModel = useOnDeviceLlmStore((s) => s.deleteModel);
  const setSelectedModel = useOnDeviceLlmStore((s) => s.setSelectedModel);

  const handleDownload = useCallback(() => {
    void downloadModel(modelId)
      .then((ok) => {
        if (ok) {
          setSelectedModel(modelId);
        }
        return ok;
      })
      .catch(() => false);
  }, [downloadModel, modelId, setSelectedModel]);

  const handleCancel = useCallback(() => {
    cancelDownload(modelId);
  }, [cancelDownload, modelId]);

  const handleDelete = useCallback(() => {
    void deleteModel(modelId);
  }, [deleteModel, modelId]);

  return (
    <GenericModelDownloadCard
      title={title}
      subtitle={subtitle}
      expectedMb={expectedMb}
      installedBytes={status?.installedBytes}
      isReady={Boolean(status?.ready)}
      isDownloading={status?.status === "downloading" || Boolean(progress)}
      progress={progress}
      errorMsg={errorMsg}
      onDownload={handleDownload}
      onCancel={handleCancel}
      onDelete={handleDelete}
    />
  );
}

function PocketVoiceSelector({
  selectedVoice,
  onSelectVoice,
}: {
  selectedVoice: PocketVoiceId;
  onSelectVoice: (voice: PocketVoiceId) => void;
}) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={settingsStyles.rowTitle}>Voix Pocket TTS (Iris · Julien · Vald)</Text>
      <Text style={settingsStyles.rowHint}>
        Tes 3 voix de référence issues d’Iris sont intégrées dans l’application.
      </Text>
      <View style={styles.pillsRow}>
        {POCKET_VOICES.map((v) => (
          <OptionPill
            key={v.id}
            value={v.id}
            label={v.label}
            selected={selectedVoice === v.id}
            onSelect={onSelectVoice}
          />
        ))}
      </View>
    </View>
  );
}

function SupertonicVoiceSelector({
  selectedLang,
  selectedVoice,
  onSelectLang,
  onSelectVoice,
}: {
  selectedLang: SupertonicLang;
  selectedVoice: SupertonicVoiceId;
  onSelectLang: (lang: SupertonicLang) => void;
  onSelectVoice: (voice: SupertonicVoiceId) => void;
}) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={settingsStyles.rowTitle}>Voix & Langue Supertonic 3</Text>
      <View style={styles.pillsRow}>
        {SUPERTONIC_LANGS.map((l) => (
          <OptionPill
            key={l.id}
            value={l.id}
            label={l.label}
            selected={selectedLang === l.id}
            onSelect={onSelectLang}
          />
        ))}
      </View>
      <View style={styles.pillsRow}>
        {SUPERTONIC_VOICES.map((v) => (
          <OptionPill
            key={v}
            value={v}
            label={v}
            selected={selectedVoice === v}
            onSelect={onSelectVoice}
          />
        ))}
      </View>
    </View>
  );
}

export function OnDeviceVoiceSection() {
  const state = useOnDeviceSpeechStore();
  const llmState = useOnDeviceLlmStore();
  const preview = useReadAloud(SAMPLE_PREVIEW_ID);

  useEffect(() => {
    useOnDeviceSpeechStore.getState().ensureInitialized();
    useOnDeviceLlmStore.getState().ensureInitialized();
  }, []);

  const asrReady = isOnDeviceAsrReady(state);
  const activeTts = resolveActiveOnDeviceTts(state);

  const handleAfterAsrInstall = useCallback(() => {
    const store = useOnDeviceSpeechStore.getState();
    store.setAsrEnabled(true);
    void store.preloadModel("asr-parakeet-v3").catch(() => undefined);
  }, []);

  const handleAfterPocketInstall = useCallback(() => {
    useOnDeviceSpeechStore.getState().setTtsEngine("pocket-fr");
  }, []);

  const handleAfterSupertonicInstall = useCallback(() => {
    const store = useOnDeviceSpeechStore.getState();
    if (!store.statuses["tts-pocket-fr"]?.ready) {
      store.setTtsEngine("supertonic-3");
    }
  }, []);

  const handlePreviewToggle = useCallback(() => {
    if (preview.isSpeaking) {
      stopReadAloud();
      return;
    }
    const text =
      state.ttsEngine === "supertonic-3" && state.supertonicLang === "en"
        ? SAMPLE_TEXT_EN
        : SAMPLE_TEXT_FR;
    toggleReadAloud(SAMPLE_PREVIEW_ID, text);
  }, [preview.isSpeaking, state.supertonicLang, state.ttsEngine]);

  if (Platform.OS !== "android") {
    return (
      <SettingsSection title="IA Vocale 100 % On-Device">
        <SettingsCard>
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>
              Les modèles ONNX embarqués (Parakeet v3, Pocket TTS FR, Supertonic 3) sont disponibles
              uniquement sur Android.
            </Text>
          </View>
        </SettingsCard>
      </SettingsSection>
    );
  }

  return (
    <View style={styles.container} testID="ondevice-voice-section">
      <SettingsSection title="Dictée vocale on-device (ASR · Parakeet v3)">
        <SettingsCard>
          <SettingsRow
            label="Activer Parakeet TDT 0.6B v3 + Silero VAD"
            hint={buildAsrHint(asrReady, state.supported, state.totalRamMb)}
          >
            <Switch
              value={state.asrEnabled}
              onValueChange={state.setAsrEnabled}
              accessibilityLabel="Activer la dictée locale Parakeet"
            />
          </SettingsRow>
          <View style={styles.cardDivider} />
          <ModelDownloadCard
            modelId="asr-parakeet-v3"
            title="NVIDIA Parakeet TDT 0.6B v3 INT8 + Silero VAD"
            subtitle="25 langues · Ponctuation native · Franglais code"
            expectedMb="~467 Mo"
            onAfterInstall={handleAfterAsrInstall}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Synthèse vocale on-device (TTS)">
        <SettingsCard>
          <View style={styles.sectionBlock}>
            <Text style={settingsStyles.rowTitle}>Moteur de lecture des réponses</Text>
            <Text style={settingsStyles.rowHint}>
              {activeTts
                ? `Actif : ${activeTts.engine === "pocket-fr" ? "Pocket TTS FR" : "Supertonic 3"} (${activeTts.voice})`
                : "Aucun modèle ONNX installé — repli temporaire sur la voix Android"}
            </Text>
            <View style={styles.pillsRow}>
              {ENGINE_OPTIONS.map((opt) => (
                <OptionPill
                  key={opt.id}
                  value={opt.id}
                  label={opt.label}
                  selected={state.ttsEngine === opt.id}
                  onSelect={state.setTtsEngine}
                />
              ))}
            </View>
          </View>

          {state.ttsEngine === "pocket-fr" ? (
            <>
              <View style={styles.cardDivider} />
              <PocketVoiceSelector
                selectedVoice={state.pocketVoice}
                onSelectVoice={state.setPocketVoice}
              />
            </>
          ) : null}

          {state.ttsEngine === "supertonic-3" ? (
            <>
              <View style={styles.cardDivider} />
              <SupertonicVoiceSelector
                selectedLang={state.supertonicLang}
                selectedVoice={state.supertonicVoice}
                onSelectLang={state.setSupertonicLang}
                onSelectVoice={state.setSupertonicVoice}
              />
            </>
          ) : null}

          <View style={styles.cardDivider} />
          <View style={styles.speedTestRow}>
            <View style={styles.speedPillsWrap}>
              {SPEED_OPTIONS.map((sp) => (
                <OptionPill
                  key={sp}
                  value={sp}
                  label={`${sp}×`}
                  selected={Math.abs(state.ttsSpeed - sp) < 0.03}
                  onSelect={state.setTtsSpeed}
                />
              ))}
            </View>
            <Button
              size="sm"
              variant={preview.isSpeaking ? "destructive" : "default"}
              leftIcon={preview.isSpeaking ? Square : Volume2}
              onPress={handlePreviewToggle}
            >
              {preview.isSpeaking ? "Stop" : "Tester la voix"}
            </Button>
          </View>

          <View style={styles.cardDivider} />
          <ModelDownloadCard
            modelId="tts-pocket-fr"
            title="Kyutai Pocket TTS FR INT8"
            subtitle="Voix naturelles FR + clonage Iris, Julien, Vald (24 kHz)"
            expectedMb="~82 Mo"
            onAfterInstall={handleAfterPocketInstall}
          />
          <View style={styles.cardDivider} />
          <ModelDownloadCard
            modelId="tts-supertonic-3"
            title="Supertone Supertonic 3 INT8"
            subtitle="Ultra-rapide · 31 langues (FR/EN) · 44,1 kHz"
            expectedMb="~123 Mo"
            onAfterInstall={handleAfterSupertonicInstall}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Reprompt IA 100 % On-Device (LiteRT-LM)">
        <SettingsCard>
          <SettingsRow
            label="Activer le bouton Reprompt (✨)"
            hint="Supprime hésitations/bégaiements de dictée vocale · Appui long = mode alternatif"
          >
            <Switch
              value={llmState.repromptEnabled}
              onValueChange={llmState.setRepromptEnabled}
              accessibilityLabel="Activer le reprompt local sur l'appareil"
            />
          </SettingsRow>
          <View style={styles.cardDivider} />
          <View style={styles.sectionBlock}>
            <Text style={settingsStyles.rowTitle}>Action au tap court sur ✨</Text>
            <View style={styles.pillsRow}>
              {REPROMPT_MODE_OPTIONS.map((opt) => (
                <OptionPill
                  key={opt.id}
                  value={opt.id}
                  label={opt.label}
                  selected={llmState.defaultMode === opt.id}
                  onSelect={llmState.setDefaultMode}
                />
              ))}
            </View>
          </View>
          <View style={styles.cardDivider} />
          <View style={styles.sectionBlock}>
            <Text style={settingsStyles.rowTitle}>Modèle local (Qwen3 LiteRT-LM)</Text>
            <Text style={settingsStyles.rowHint}>
              {llmState.statuses[llmState.selectedModel]?.ready
                ? "Prêt sur GPU/CPU local — zéro serveur"
                : "Téléchargement automatique au 1er appui sur ✨ ou ci-dessous"}
            </Text>
            <View style={styles.pillsRow}>
              {ONDEVICE_LLM_CATALOG.map((model) => (
                <OptionPill
                  key={model.id}
                  value={model.id}
                  label={`${model.id === "qwen3.5-0.8b" ? "Qwen3.5 0.8B" : "Qwen3 1.7B"} (${model.badge})`}
                  selected={llmState.selectedModel === model.id}
                  onSelect={llmState.setSelectedModel}
                />
              ))}
            </View>
          </View>
          {ONDEVICE_LLM_CATALOG.map((model) => (
            <Fragment key={model.id}>
              <View style={styles.cardDivider} />
              <LlmModelDownloadCard
                modelId={model.id}
                title={model.title}
                subtitle={model.subtitle}
                expectedMb={model.expectedMb}
              />
            </Fragment>
          ))}
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
  },
  cardDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  modelCard: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  modelHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  modelTextWrap: {
    flex: 1,
    gap: 2,
  },
  sizeHint: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    fontWeight: "600",
  },
  readyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  readyBadgeText: {
    fontSize: 12,
    color: theme.colors.accent,
    fontWeight: "600",
  },
  progressSection: {
    gap: theme.spacing[2],
  },
  progressBarBg: {
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  errorText: {
    fontSize: 12,
    color: theme.colors.destructive,
  },
  sectionBlock: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: 2,
  },
  pill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  pillSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  pillTextSelected: {
    color: theme.colors.accentForeground,
  },
  speedTestRow: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  speedPillsWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
}));
