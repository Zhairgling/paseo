import { Mic, MicOff, Plug, Send, Square } from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { type DaemonHttpTarget } from "./api";
import { DEFAULT_LFM3_WS_URL, Lfm3VoiceClient } from "./lfm3-voice-client";

export function Lfm3VoicePanel({ target }: { target: DaemonHttpTarget }): ReactElement {
  const client = useMemo(() => new Lfm3VoiceClient(target, DEFAULT_LFM3_WS_URL), [target]);
  const state = useSyncExternalStore(
    client.subscribe,
    () => client.getState(),
    () => client.getState(),
  );
  const [wsUrlInput, setWsUrlInput] = useState(DEFAULT_LFM3_WS_URL);
  const [textInput, setTextInput] = useState("");
  const [textResetKey, setTextResetKey] = useState(0);

  useEffect(() => {
    client.setTarget(target);
  }, [client, target]);

  useEffect(() => {
    return () => {
      client.disconnect();
    };
  }, [client]);

  const handleToggleConnect = useCallback(() => {
    if (state.connectionState === "ready" || state.connectionState === "connecting") {
      client.disconnect();
      return;
    }
    client.connect(wsUrlInput);
  }, [client, state.connectionState, wsUrlInput]);

  const handleTogglePtt = useCallback(() => {
    if (state.isCapturing) {
      void client.commitPushToTalk();
      return;
    }
    void client.startPushToTalk();
  }, [client, state.isCapturing]);

  const handleSendText = useCallback(() => {
    if (!textInput.trim()) return;
    client.sendTextPrompt(textInput);
    setTextInput("");
    setTextResetKey((k) => k + 1);
  }, [client, textInput]);

  const handleCancel = useCallback(() => {
    client.cancelResponse();
  }, [client]);

  const isConnected = state.connectionState === "ready";

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Assistant Vocal LFM3-Audio-2B (blade RTX 3070 Ti)</Text>
      <Text style={styles.meta}>
        {`État : ${state.connectionState}${state.modelLabel ? ` · ${state.modelLabel}` : ""}`}
      </Text>

      <AdaptiveTextInput
        initialValue={wsUrlInput}
        resetKey="lfm3-url"
        onChangeText={setWsUrlInput}
        placeholder="ws://100.67.68.24:18765"
        style={styles.input}
      />

      <View style={styles.row}>
        <Button
          size="sm"
          variant={isConnected ? "outline" : "default"}
          leftIcon={Plug}
          onPress={handleToggleConnect}
        >
          {isConnected ? "Déconnecter" : "Connecter LFM3"}
        </Button>
        <Button
          size="sm"
          variant={state.isCapturing ? "destructive" : "default"}
          leftIcon={state.isCapturing ? MicOff : Mic}
          onPress={handleTogglePtt}
        >
          {state.isCapturing ? "Envoyer audio" : "Parler (PTT)"}
        </Button>
        {state.isGenerating ? (
          <Button size="sm" variant="ghost" leftIcon={Square} onPress={handleCancel}>
            Stop (Barge-in)
          </Button>
        ) : null}
      </View>

      <View style={styles.row}>
        <AdaptiveTextInput
          initialValue={textInput}
          resetKey={textResetKey}
          onChangeText={setTextInput}
          placeholder="Message texte vers LFM3 (ex: liste les sessions)..."
          style={styles.flexInput}
        />
        <Button size="sm" variant="outline" leftIcon={Send} onPress={handleSendText}>
          Envoyer
        </Button>
      </View>

      {state.streamingText ? <Text style={styles.streamBox}>{state.streamingText}</Text> : null}

      {state.metrics ? (
        <Text style={styles.meta}>
          {`Latence — TTFT: ${Math.round(state.metrics.ttftMs)} ms · TTFA: ${Math.round(state.metrics.ttfaMs)} ms · Total: ${Math.round(state.metrics.totalMs)} ms`}
        </Text>
      ) : null}

      {state.toolLogs.length > 0 ? (
        <Text style={styles.meta}>
          {`Dernier outil : ${state.toolLogs[0]!.name} → ${JSON.stringify(state.toolLogs[0]!.output).slice(0, 120)}`}
        </Text>
      ) : null}

      {state.lastError ? <Text style={styles.errText}>{state.lastError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.base,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
  },
  flexInput: {
    flex: 1,
    minWidth: 180,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.base,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
  },
  streamBox: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    fontSize: theme.fontSize.sm,
  },
  errText: {
    color: "#ef4444",
    fontSize: theme.fontSize.sm,
  },
}));
