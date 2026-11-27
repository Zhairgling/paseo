import { AppearanceText as Text } from "@/appearance/text";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useOnDeviceSpeechStore, type TtsEnginePreference } from "@/stores/ondevice-speech-store";
import type { Theme } from "@/styles/theme";
import { restartReadAloud } from "@/utils/read-aloud";
import { Check, Download, Volume2 } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { PocketVoiceId, SupertonicVoiceId } from "../../modules/aju-ondevice-speech";

interface QuickVoicePickerTarget {
  speakId: string;
  getContent: () => string;
}

const ThemedCheck = withUnistyles(Check, (theme: Theme) => ({
  color: theme.colors.accent,
}));
const ThemedVolume = withUnistyles(Volume2, (theme: Theme) => ({
  color: theme.colors.accent,
}));

const POCKET_VOICES: ReadonlyArray<{ id: PocketVoiceId; label: string; hint: string }> = [
  { id: "iris", label: "Iris", hint: "Claire" },
  { id: "julien", label: "Julien", hint: "Ta voix" },
  { id: "vald", label: "Vald", hint: "Posée" },
  { id: "estelle", label: "Estelle", hint: "Douce" },
  { id: "fabien", label: "Fabien", hint: "Chaude" },
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

const SPEED_OPTIONS = [0.85, 1.0, 1.15, 1.3] as const;

let currentTarget: QuickVoicePickerTarget | null = null;
const targetListeners = new Set<() => void>();

function notifyTarget(): void {
  for (const listener of targetListeners) {
    listener();
  }
}

function subscribeTarget(listener: () => void): () => void {
  targetListeners.add(listener);
  return () => {
    targetListeners.delete(listener);
  };
}

function getTargetSnapshot(): QuickVoicePickerTarget | null {
  return currentTarget;
}

export function openQuickVoicePicker(target: QuickVoicePickerTarget): void {
  currentTarget = target;
  notifyTarget();
}

export function closeQuickVoicePicker(): void {
  if (currentTarget === null) return;
  currentTarget = null;
  notifyTarget();
}

const PocketVoiceChip = memo(function PocketVoiceChip({
  id,
  label,
  hint,
  selected,
  disabled,
  onSelect,
}: {
  id: PocketVoiceId;
  label: string;
  hint: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: PocketVoiceId) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <PressHighlight
      onPress={handlePress}
      disabled={disabled}
      style={[
        styles.voiceCard,
        selected && styles.voiceCardActive,
        disabled && styles.cardDisabled,
      ]}
      accessibilityRole="button"
      testID={`quick-voice-pocket-${id}`}
    >
      <View style={styles.voiceCardHeader}>
        <Text style={[styles.voiceName, selected && styles.voiceNameActive]}>{label}</Text>
        {selected ? <ThemedCheck size={14} /> : null}
      </View>
      <Text style={styles.voiceHint}>{hint}</Text>
    </PressHighlight>
  );
});

const SupertonicVoiceChip = memo(function SupertonicVoiceChip({
  id,
  selected,
  disabled,
  onSelect,
}: {
  id: SupertonicVoiceId;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: SupertonicVoiceId) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <PressHighlight
      onPress={handlePress}
      disabled={disabled}
      style={[
        styles.compactChip,
        selected && styles.compactChipActive,
        disabled && styles.cardDisabled,
      ]}
      accessibilityRole="button"
      testID={`quick-voice-supertonic-${id}`}
    >
      <Text style={[styles.compactChipText, selected && styles.compactChipTextActive]}>{id}</Text>
    </PressHighlight>
  );
});

const SpeedChip = memo(function SpeedChip({
  value,
  selected,
  onSelect,
}: {
  value: number;
  selected: boolean;
  onSelect: (value: number) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(value);
  }, [onSelect, value]);

  return (
    <PressHighlight
      onPress={handlePress}
      style={[styles.compactChip, selected && styles.compactChipActive]}
      accessibilityRole="button"
      testID={`quick-voice-speed-${value}`}
    >
      <Text style={[styles.compactChipText, selected && styles.compactChipTextActive]}>
        {value === 1 ? "1×" : `${value}×`}
      </Text>
    </PressHighlight>
  );
});

export const QuickVoicePickerHost = memo(function QuickVoicePickerHost() {
  const target = useSyncExternalStore(subscribeTarget, getTargetSnapshot, getTargetSnapshot);
  const ensureInitialized = useOnDeviceSpeechStore((s) => s.ensureInitialized);
  const statuses = useOnDeviceSpeechStore((s) => s.statuses);
  const ttsEngine = useOnDeviceSpeechStore((s) => s.ttsEngine);
  const pocketVoice = useOnDeviceSpeechStore((s) => s.pocketVoice);
  const supertonicVoice = useOnDeviceSpeechStore((s) => s.supertonicVoice);
  const ttsSpeed = useOnDeviceSpeechStore((s) => s.ttsSpeed);
  const setTtsEngine = useOnDeviceSpeechStore((s) => s.setTtsEngine);
  const setPocketVoice = useOnDeviceSpeechStore((s) => s.setPocketVoice);
  const setSupertonicVoice = useOnDeviceSpeechStore((s) => s.setSupertonicVoice);
  const setTtsSpeed = useOnDeviceSpeechStore((s) => s.setTtsSpeed);
  const downloadModel = useOnDeviceSpeechStore((s) => s.downloadModel);

  useEffect(() => {
    if (target) {
      ensureInitialized();
    }
  }, [ensureInitialized, target]);

  const pocketStatus = statuses["tts-pocket-fr"];
  const superStatus = statuses["tts-supertonic-3"];
  const pocketReady = Boolean(pocketStatus?.ready);
  const superReady = Boolean(superStatus?.ready);

  const speakCurrentTarget = useCallback(() => {
    if (!target) return;
    const content = target.getContent();
    closeQuickVoicePicker();
    if (content) {
      restartReadAloud(target.speakId, content);
    }
  }, [target]);

  const handleSelectPocket = useCallback(
    (voiceId: PocketVoiceId) => {
      setTtsEngine("pocket-fr");
      setPocketVoice(voiceId);
      speakCurrentTarget();
    },
    [setPocketVoice, setTtsEngine, speakCurrentTarget],
  );

  const handleSelectSupertonic = useCallback(
    (voiceId: SupertonicVoiceId) => {
      setTtsEngine("supertonic-3");
      setSupertonicVoice(voiceId);
      speakCurrentTarget();
    },
    [setSupertonicVoice, setTtsEngine, speakCurrentTarget],
  );

  const handleSelectSystem = useCallback(() => {
    const engine: TtsEnginePreference = "system";
    setTtsEngine(engine);
    speakCurrentTarget();
  }, [setTtsEngine, speakCurrentTarget]);

  const handleSelectSpeed = useCallback(
    (speed: number) => {
      setTtsSpeed(speed);
      speakCurrentTarget();
    },
    [setTtsSpeed, speakCurrentTarget],
  );

  const handleDownloadPocket = useCallback(() => {
    void downloadModel("tts-pocket-fr");
  }, [downloadModel]);

  const handleDownloadSupertonic = useCallback(() => {
    void downloadModel("tts-supertonic-3");
  }, [downloadModel]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: "Choisir une voix",
      subtitle: "Sélectionne une voix pour relire ce message immédiatement",
      leading: <ThemedVolume size={18} />,
    }),
    [],
  );

  return (
    <AdaptiveModalSheet
      visible={target !== null}
      onClose={closeQuickVoicePicker}
      header={header}
      desktopMaxWidth={420}
      testID="quick-voice-picker-sheet"
    >
      <View style={styles.container}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Pocket TTS FR (local)</Text>
          {!pocketReady ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={handleDownloadPocket}
              disabled={pocketStatus?.status === "downloading"}
              testID="quick-voice-download-pocket"
            >
              <Download size={13} color={styles.downloadIcon.color} />
              <Text style={styles.downloadText}>
                {pocketStatus?.status === "downloading"
                  ? "Téléchargement…"
                  : "Télécharger (177 Mo)"}
              </Text>
            </Button>
          ) : null}
        </View>
        <View style={styles.voiceGrid}>
          {POCKET_VOICES.map((voice) => (
            <PocketVoiceChip
              key={voice.id}
              id={voice.id}
              label={voice.label}
              hint={voice.hint}
              selected={ttsEngine === "pocket-fr" && pocketVoice === voice.id}
              disabled={!pocketReady}
              onSelect={handleSelectPocket}
            />
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Supertonic 3 (FR / EN)</Text>
          {!superReady ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={handleDownloadSupertonic}
              disabled={superStatus?.status === "downloading"}
              testID="quick-voice-download-supertonic"
            >
              <Download size={13} color={styles.downloadIcon.color} />
              <Text style={styles.downloadText}>
                {superStatus?.status === "downloading" ? "Téléchargement…" : "Télécharger (278 Mo)"}
              </Text>
            </Button>
          ) : null}
        </View>
        <View style={styles.chipRow}>
          {SUPERTONIC_VOICES.map((voiceId) => (
            <SupertonicVoiceChip
              key={voiceId}
              id={voiceId}
              selected={ttsEngine === "supertonic-3" && supertonicVoice === voiceId}
              disabled={!superReady}
              onSelect={handleSelectSupertonic}
            />
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Vitesse</Text>
        </View>
        <View style={styles.chipRow}>
          {SPEED_OPTIONS.map((speed) => (
            <SpeedChip
              key={speed}
              value={speed}
              selected={Math.abs(ttsSpeed - speed) < 0.03}
              onSelect={handleSelectSpeed}
            />
          ))}
        </View>

        <PressHighlight
          onPress={handleSelectSystem}
          style={[styles.systemRow, ttsEngine === "system" && styles.voiceCardActive]}
          accessibilityRole="button"
          testID="quick-voice-system"
        >
          <Text style={[styles.voiceName, ttsEngine === "system" && styles.voiceNameActive]}>
            Voix système Android
          </Text>
          {ttsEngine === "system" ? <ThemedCheck size={16} /> : null}
        </PressHighlight>
      </View>
    </AdaptiveModalSheet>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  voiceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  voiceCard: {
    minWidth: 102,
    flexGrow: 1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface1,
    gap: 2,
  },
  voiceCardActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  cardDisabled: {
    opacity: 0.45,
  },
  voiceCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[1],
  },
  voiceName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  voiceNameActive: {
    color: theme.colors.accent,
  },
  voiceHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  compactChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface1,
  },
  compactChipActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  compactChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  compactChipTextActive: {
    color: theme.colors.accent,
    fontWeight: theme.fontWeight.semibold,
  },
  systemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface1,
    marginTop: theme.spacing[1],
  },
  downloadIcon: {
    color: theme.colors.foreground,
  },
  downloadText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
}));
