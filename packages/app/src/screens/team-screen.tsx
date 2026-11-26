import { router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  homelabFetchJson,
  resolveHomelabDaemonTarget,
  type HomelabGpuNode,
  type HomelabGpuStatus,
  type HomelabTeamAgent,
  type HomelabTeamView,
  type HomelabTimelineItem,
} from "@/homelab/api";
import { useHosts } from "@/runtime/host-runtime";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

type TabId = "team" | "gpu" | "docs";
type TargetId = "both" | "mac" | "evo" | "air" | "blade" | "launch_both";
type BehaviorId = "queue" | "steer" | "interrupt";
type NodeHealth = "ok" | "warn" | "off";

const ThemedRefreshIcon = withUnistyles(RefreshCw, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const TAB_OPTIONS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "team", label: "Équipe unifiée" },
  { id: "gpu", label: "Monitoring GPU" },
  { id: "docs", label: "Board & Docs" },
];

const TARGET_OPTIONS: ReadonlyArray<{ id: TargetId; label: string }> = [
  { id: "both", label: "Les deux (Mac + EVO)" },
  { id: "mac", label: "Mac 8-bit" },
  { id: "evo", label: "EVO Gemma 4" },
  { id: "air", label: "Air explore" },
  { id: "blade", label: "Blade verify" },
  { id: "launch_both", label: "Lancer duo Mac+EVO" },
];

const BEHAVIOR_OPTIONS: ReadonlyArray<{ id: BehaviorId; label: string }> = [
  { id: "queue", label: "File (queue)" },
  { id: "steer", label: "Steer" },
  { id: "interrupt", label: "Interrompre" },
];

function fmtTime(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function getNodeHealth(node: HomelabGpuNode): NodeHealth {
  if (node.ready) return "ok";
  if (node.online) return "warn";
  return "off";
}

function getEvoHealth(node: HomelabGpuNode): NodeHealth {
  if (!node.online) return "off";
  return node.irisDegraded ? "ok" : "warn";
}

function getNodeBadgeLabel(node: HomelabGpuNode): string {
  if (node.ready) return "PRÊT";
  if (node.online) return "EN LIGNE";
  return "HORS LIGNE";
}

export function TeamScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <TeamScreenContent />;
}

function TeamScreenContent(): ReactElement {
  const hosts = useHosts();
  const primaryServerId = hosts[0]?.serverId ?? null;
  const target = useMemo(() => resolveHomelabDaemonTarget(hosts), [hosts]);

  const [tab, setTab] = useState<TabId>("team");
  const [selectedCwd, setSelectedCwd] = useState<string>("");
  const [gpu, setGpu] = useState<HomelabGpuStatus | null>(null);
  const [team, setTeam] = useState<HomelabTeamView | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<string>("");
  const [docContent, setDocContent] = useState<string>("");
  const [feedback, setFeedback] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const refreshAll = useCallback(async () => {
    try {
      const cwdQuery = selectedCwd ? `?cwd=${encodeURIComponent(selectedCwd)}` : "";
      const [gpuRes, teamRes] = await Promise.all([
        homelabFetchJson<HomelabGpuStatus>(target, "/api/homelab/gpu"),
        homelabFetchJson<HomelabTeamView>(target, `/api/homelab/team${cwdQuery}`),
      ]);
      setGpu(gpuRes);
      setTeam(teamRes);
      setErrorMsg("");
      if (!selectedCwd && teamRes.cwd) {
        setSelectedCwd(teamRes.cwd);
      }
      if (!selectedDoc && teamRes.docs.length > 0) {
        setSelectedDoc(teamRes.docs[0]?.rel ?? "");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur de synchronisation homelab");
    }
  }, [selectedCwd, selectedDoc, target]);

  useEffect(() => {
    void refreshAll();
    const timer = setInterval(() => {
      void refreshAll();
    }, 3500);
    return () => clearInterval(timer);
  }, [refreshAll]);

  useEffect(() => {
    if (tab !== "docs" || !selectedDoc || !team?.cwd) return;
    let active = true;
    void homelabFetchJson<{ content: string }>(
      target,
      `/api/homelab/doc?cwd=${encodeURIComponent(team.cwd)}&file=${encodeURIComponent(selectedDoc)}`,
    )
      .then((res) => {
        if (active) setDocContent(res.content);
        return undefined;
      })
      .catch(() => {
        if (active) setDocContent("(impossible de charger ce fichier)");
      });
    return () => {
      active = false;
    };
  }, [selectedDoc, tab, target, team?.cwd]);

  const handleRefreshPress = useCallback(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleOpenGpuTab = useCallback(() => {
    setTab("gpu");
  }, []);

  const openAgentNative = useCallback(
    (agentId: string, workspaceId: string) => {
      if (!primaryServerId) return;
      router.push(buildHostAgentDetailRoute(primaryServerId, agentId, workspaceId || undefined));
    },
    [primaryServerId],
  );

  const headerRight = useMemo(
    () => (
      <Button variant="ghost" size="sm" onPress={handleRefreshPress}>
        <ThemedRefreshIcon size={14} />
      </Button>
    ),
    [handleRefreshPress],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title="Équipe & GPU (Atelier)" rightContent={headerRight} />

      <TopStrip tab={tab} onSelectTab={setTab} gpu={gpu} onOpenGpu={handleOpenGpuTab} />

      {errorMsg ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : null}

      {tab === "team" ? (
        <TeamTabPanel
          target={target}
          team={team}
          selectedCwd={selectedCwd}
          onSelectCwd={setSelectedCwd}
          onOpenAgent={openAgentNative}
          onRefresh={handleRefreshPress}
          feedback={feedback}
          onFeedback={setFeedback}
        />
      ) : null}

      {tab === "gpu" ? (
        <GpuTabPanel
          target={target}
          gpu={gpu}
          onRefresh={handleRefreshPress}
          feedback={feedback}
          onFeedback={setFeedback}
        />
      ) : null}

      {tab === "docs" ? (
        <DocsTabPanel
          team={team}
          selectedDoc={selectedDoc}
          docContent={docContent}
          onSelectDoc={setSelectedDoc}
        />
      ) : null}
    </View>
  );
}

function TopStrip({
  tab,
  onSelectTab,
  gpu,
  onOpenGpu,
}: {
  tab: TabId;
  onSelectTab: (id: TabId) => void;
  gpu: HomelabGpuStatus | null;
  onOpenGpu: () => void;
}) {
  const nodes = gpu?.nodes;
  return (
    <View style={styles.topStrip}>
      <View style={styles.tabsRow}>
        {TAB_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.id}
            value={opt.id}
            label={opt.label}
            active={tab === opt.id}
            onSelect={onSelectTab}
          />
        ))}
      </View>

      {nodes ? (
        <View style={styles.gpuPillsRow}>
          <GpuPill label="Mac 8-bit" status={getNodeHealth(nodes.mac)} onPress={onOpenGpu} />
          <GpuPill
            label={nodes.evo.irisDegraded ? "EVO 128K" : "EVO Iris"}
            status={getEvoHealth(nodes.evo)}
            onPress={onOpenGpu}
          />
          <GpuPill label="Air" status={getNodeHealth(nodes.air)} onPress={onOpenGpu} />
          <GpuPill label="Blade" status={getNodeHealth(nodes.blade)} onPress={onOpenGpu} />
        </View>
      ) : null}
    </View>
  );
}

function FilterChip<T extends string>({
  value,
  label,
  active,
  onSelect,
}: {
  value: T;
  label: string;
  active: boolean;
  onSelect: (val: T) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(value);
  }, [onSelect, value]);

  return (
    <PressHighlight onPress={handlePress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </PressHighlight>
  );
}

function AgentChipButton({
  agent,
  onOpenAgent,
}: {
  agent: HomelabTeamAgent;
  onOpenAgent: (agentId: string, workspaceId: string) => void;
}) {
  const handlePress = useCallback(() => {
    onOpenAgent(agent.id, agent.workspaceId);
  }, [agent.id, agent.workspaceId, onOpenAgent]);

  return (
    <PressHighlight onPress={handlePress} style={styles.agentChip}>
      <View style={[styles.dot, agent.status === "running" ? styles.dotOk : styles.dotWarn]} />
      <Text style={styles.agentChipBadge}>{agent.badge}</Text>
      <Text style={styles.agentChipTitle} numberOfLines={1}>
        {agent.title}
      </Text>
    </PressHighlight>
  );
}

function ExpandableBlock({ label, content }: { label: string; content: string }) {
  const [open, setOpen] = useState(false);
  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  return (
    <PressHighlight onPress={handleToggle} style={styles.detailBox}>
      <Text style={styles.monoMuted}>
        {open ? "▾" : "▸"} {label}
      </Text>
      {open ? <Text style={styles.monoBlock}>{content}</Text> : null}
    </PressHighlight>
  );
}

function TimelineMessageCard({
  item,
  onOpenAgent,
}: {
  item: HomelabTimelineItem;
  onOpenAgent: (agentId: string, workspaceId: string) => void;
}) {
  const isUser = item.role === "user";
  const handleOpen = useCallback(() => {
    onOpenAgent(item.agentId, item.workspaceId);
  }, [item.agentId, item.workspaceId, onOpenAgent]);

  return (
    <View style={[styles.msgCard, isUser && styles.msgUser, item.isSub && styles.msgSub]}>
      <View style={styles.msgHead}>
        <View style={styles.msgAuthorRow}>
          <View style={[styles.badgePill, isUser && styles.badgeAccent]}>
            <Text style={[styles.badgeText, isUser && styles.badgeAccentText]}>{item.badge}</Text>
          </View>
          <Text style={styles.msgAuthor}>{item.tag}</Text>
          {!isUser ? (
            <PressHighlight onPress={handleOpen}>
              <Text style={styles.monoLink}>{item.agentShort}</Text>
            </PressHighlight>
          ) : null}
        </View>
        <Text style={styles.monoMuted}>{fmtTime(item.ts)}</Text>
      </View>

      {item.text ? <Text style={styles.msgBody}>{item.text}</Text> : null}

      {item.tools.map((tool) => (
        <ExpandableBlock
          key={`${item.id}-t-${tool.name}-${tool.input.slice(0, 32)}`}
          label={`${tool.name} (${tool.status || "ok"})`}
          content={`IN: ${tool.input}\nOUT: ${tool.output}`}
        />
      ))}

      {item.reasoning ? (
        <ExpandableBlock
          label={`Raisonnement (${item.reasoning.length} car.)`}
          content={item.reasoning}
        />
      ) : null}
    </View>
  );
}

function TeamTabPanel({
  target,
  team,
  selectedCwd,
  onSelectCwd,
  onOpenAgent,
  onRefresh,
  feedback,
  onFeedback,
}: {
  target: ReturnType<typeof resolveHomelabDaemonTarget>;
  team: HomelabTeamView | null;
  selectedCwd: string;
  onSelectCwd: (cwd: string) => void;
  onOpenAgent: (agentId: string, workspaceId: string) => void;
  onRefresh: () => void;
  feedback: string;
  onFeedback: (msg: string) => void;
}) {
  const [sendTarget, setSendTarget] = useState<TargetId>("both");
  const [sendBehavior, setSendBehavior] = useState<BehaviorId>("queue");
  const [promptText, setPromptText] = useState<string>("");
  const [resetKey, setResetKey] = useState<number>(0);
  const [sending, setSending] = useState<boolean>(false);

  const handleSend = useCallback(async () => {
    const trimmed = promptText.trim();
    if (!trimmed || sending) return;
    setSending(true);
    onFeedback("Envoi en cours...");
    try {
      const res = await homelabFetchJson<{ ok: boolean; results?: unknown[]; error?: string }>(
        target,
        "/api/homelab/send",
        {
          method: "POST",
          body: {
            target: sendTarget,
            behavior: sendBehavior,
            prompt: trimmed,
            cwd: selectedCwd || team?.cwd,
          },
        },
      );
      if (res.ok) {
        setPromptText("");
        setResetKey((k) => k + 1);
        onFeedback(`Envoyé (${res.results?.length ?? 1} cible(s))`);
        setTimeout(onRefresh, 600);
      } else {
        onFeedback(res.error ?? "Échec d'envoi");
      }
    } catch (err) {
      onFeedback(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setSending(false);
    }
  }, [
    onFeedback,
    onRefresh,
    promptText,
    selectedCwd,
    sendBehavior,
    sendTarget,
    sending,
    target,
    team?.cwd,
  ]);

  const handleSendPress = useCallback(() => {
    void handleSend();
  }, [handleSend]);

  const activeCwd = selectedCwd || team?.cwd || "";

  return (
    <View style={styles.flexCol}>
      <View style={styles.subBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {(team?.knownCwds ?? []).map((cwd) => (
            <FilterChip
              key={cwd}
              value={cwd}
              label={cwd.split("/").pop() || cwd}
              active={cwd === activeCwd}
              onSelect={onSelectCwd}
            />
          ))}
        </ScrollView>

        {team && team.agents.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {team.agents.map((ag) => (
              <AgentChipButton key={ag.id} agent={ag} onOpenAgent={onOpenAgent} />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.feedContent}>
        {!team || team.timeline.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.mutedText}>
              Aucun échange OpenCode récent sur ce dépôt. Sélectionnez un autre dépôt ci-dessus ou
              lancez un duo Mac + EVO avec le composer ci-dessous.
            </Text>
          </View>
        ) : (
          team.timeline.map((item) => (
            <TimelineMessageCard key={item.id} item={item} onOpenAgent={onOpenAgent} />
          ))
        )}
      </ScrollView>

      <View style={styles.composer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {TARGET_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.id}
              value={opt.id}
              label={opt.label}
              active={sendTarget === opt.id}
              onSelect={setSendTarget}
            />
          ))}
          <View style={styles.sep} />
          {BEHAVIOR_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.id}
              value={opt.id}
              label={opt.label}
              active={sendBehavior === opt.id}
              onSelect={setSendBehavior}
            />
          ))}
        </ScrollView>

        <View style={styles.composerRow}>
          <AdaptiveTextInput
            initialValue=""
            resetKey={resetKey}
            onChangeText={setPromptText}
            placeholder="Consigne à l'équipe Multi-GPU..."
            multiline
            style={styles.composerInput}
          />
          <Button
            variant="default"
            size="md"
            disabled={sending || !promptText.trim()}
            onPress={handleSendPress}
          >
            Envoyer
          </Button>
        </View>
        {feedback ? <Text style={styles.feedbackText}>{feedback}</Text> : null}
      </View>
    </View>
  );
}

function ColabRouterCard({ gpu, onToggleTts }: { gpu: HomelabGpuStatus; onToggleTts: () => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Routeur Colab G4 & Pocket TTS (:11435)</Text>
      <Text style={styles.kvLine}>
        Cible primaire : {gpu.router.active_primary_target ?? "—"} · Colab :{" "}
        {gpu.colab.state ?? "inconnu"} ({gpu.colab.gpu ?? "—"})
      </Text>
      <Text style={styles.kvLine}>
        Compute Units : {gpu.colab.compute_units_balance ?? "—"} CU (
        {gpu.colab.compute_units_rate_hr ?? 0} CU/h)
      </Text>
      <Text style={styles.kvLine}>
        Pocket TTS : {gpu.router.pocket_tts_online ? "En ligne" : "Hors ligne"} (
        {gpu.router.tts_voice ?? "Iris"}) · {gpu.router.tts_enabled ? "ON" : "OFF"}
      </Text>
      <View style={styles.cardActions}>
        <Button variant="secondary" size="sm" onPress={onToggleTts}>
          {gpu.router.tts_enabled ? "Couper TTS" : "Activer TTS"}
        </Button>
      </View>
    </View>
  );
}

function formatEvoModeLine(gpu: HomelabGpuStatus): string {
  const mode = gpu.nodes.evo.irisDegraded ? "Iris Dégradé (Dev Brain 128K)" : "Iris Normal (Vocal)";
  if (gpu.irisSwitch.switching) {
    return `Mode : ${mode} · Bascule -> ${gpu.irisSwitch.target ?? ""}`;
  }
  return `Mode : ${mode}`;
}

function GpuTabPanel({
  target,
  gpu,
  onRefresh,
  feedback,
  onFeedback,
}: {
  target: ReturnType<typeof resolveHomelabDaemonTarget>;
  gpu: HomelabGpuStatus | null;
  onRefresh: () => void;
  feedback: string;
  onFeedback: (msg: string) => void;
}) {
  const toggleFlag = useCallback(
    async (key: "mac_enabled" | "blade_enabled" | "tts_enabled", value: boolean) => {
      try {
        await homelabFetchJson(target, "/api/homelab/router", {
          method: "POST",
          body: { [key]: value },
        });
        onFeedback("Routeur mis à jour");
        onRefresh();
      } catch (err) {
        onFeedback(err instanceof Error ? err.message : "Erreur routeur");
      }
    },
    [onFeedback, onRefresh, target],
  );

  const switchIris = useCallback(
    async (mode: "degraded" | "normal") => {
      try {
        const res = await homelabFetchJson<{ ok: boolean; message?: string }>(
          target,
          "/api/homelab/iris-mode",
          { method: "POST", body: { mode } },
        );
        onFeedback(res.message ?? `Bascule vers ${mode} lancée`);
        onRefresh();
      } catch (err) {
        onFeedback(err instanceof Error ? err.message : "Erreur bascule Iris");
      }
    },
    [onFeedback, onRefresh, target],
  );

  const handleToggleMac = useCallback(() => {
    void toggleFlag("mac_enabled", !(gpu?.nodes.mac.enabled ?? true));
  }, [gpu?.nodes.mac.enabled, toggleFlag]);

  const handleToggleBlade = useCallback(() => {
    void toggleFlag("blade_enabled", !(gpu?.nodes.blade.enabled ?? true));
  }, [gpu?.nodes.blade.enabled, toggleFlag]);

  const handleToggleTts = useCallback(() => {
    void toggleFlag("tts_enabled", !(gpu?.router.tts_enabled ?? false));
  }, [gpu?.router.tts_enabled, toggleFlag]);

  const handleSwitchIris = useCallback(() => {
    const nextMode = gpu?.nodes.evo.irisDegraded ? "normal" : "degraded";
    void switchIris(nextMode);
  }, [gpu?.nodes.evo.irisDegraded, switchIris]);

  if (!gpu) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.gpuContent}>
        <View style={styles.emptyCard}>
          <Text style={styles.mutedText}>Sondage des nœuds GPU en cours...</Text>
        </View>
      </ScrollView>
    );
  }

  const { nodes } = gpu;
  const macLabel = nodes.mac.enabled ? "Désactiver dans le routeur" : "Activer dans le routeur";
  const bladeLabel = nodes.blade.enabled ? "Désactiver dans le routeur" : "Activer dans le routeur";
  const irisLabel = nodes.evo.irisDegraded ? "Revenir Iris Normal" : "Activer Iris Dégradé 128K";

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.gpuContent}>
      <View style={styles.gpuGrid}>
        <GpuCard node={nodes.mac} actionLabel={macLabel} onAction={handleToggleMac} />
        <GpuCard
          node={nodes.evo}
          extraLine={formatEvoModeLine(gpu)}
          actionLabel={irisLabel}
          actionDisabled={gpu.irisSwitch.switching}
          onAction={handleSwitchIris}
        />
        <GpuCard
          node={nodes.air}
          extraLine={`Modèles chargés : ${(nodes.air.models ?? []).length}`}
        />
        <GpuCard node={nodes.blade} actionLabel={bladeLabel} onAction={handleToggleBlade} />
      </View>

      <ColabRouterCard gpu={gpu} onToggleTts={handleToggleTts} />
      {feedback ? <Text style={styles.feedbackText}>{feedback}</Text> : null}
    </ScrollView>
  );
}

function DocsTabPanel({
  team,
  selectedDoc,
  docContent,
  onSelectDoc,
}: {
  team: HomelabTeamView | null;
  selectedDoc: string;
  docContent: string;
  onSelectDoc: (rel: string) => void;
}) {
  return (
    <View style={styles.flexCol}>
      <View style={styles.subBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {(team?.docs ?? []).map((d) => (
            <FilterChip
              key={d.rel}
              value={d.rel}
              label={`${d.name} (${d.sizeKb} Ko)`}
              active={d.rel === selectedDoc}
              onSelect={onSelectDoc}
            />
          ))}
        </ScrollView>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.gpuContent}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{selectedDoc || "Document"}</Text>
          <Text style={styles.monoBlock}>
            {docContent || team?.board || "(aucun document sélectionné)"}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function dotStyleFor(status: NodeHealth) {
  if (status === "ok") return styles.dotOk;
  if (status === "warn") return styles.dotWarn;
  return styles.dotOff;
}

function GpuPill({
  label,
  status,
  onPress,
}: {
  label: string;
  status: NodeHealth;
  onPress: () => void;
}) {
  return (
    <PressHighlight onPress={onPress} style={styles.gpuPill}>
      <View style={[styles.dot, dotStyleFor(status)]} />
      <Text style={styles.gpuPillText}>{label}</Text>
    </PressHighlight>
  );
}

function GpuCard({
  node,
  extraLine,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  node: HomelabGpuNode;
  extraLine?: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.msgHead}>
        <Text style={styles.cardTitle}>{node.name}</Text>
        <View style={[styles.badgePill, node.ready ? styles.badgeOk : styles.badgeWarn]}>
          <Text style={[styles.badgeText, node.ready ? styles.badgeOkText : styles.badgeWarnText]}>
            {getNodeBadgeLabel(node)}
          </Text>
        </View>
      </View>
      <Text style={styles.mutedText}>{node.role}</Text>
      <Text style={styles.monoMuted}>{node.model}</Text>
      <Text style={styles.monoMuted}>{node.endpoint}</Text>
      {extraLine ? <Text style={styles.kvLine}>{extraLine}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.cardActions}>
          <Button variant="default" size="sm" disabled={actionDisabled} onPress={onAction}>
            {actionLabel}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  flexCol: {
    flex: 1,
    minHeight: 0,
  },
  topStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabsRow: {
    flexDirection: "row",
    gap: theme.spacing[1.5],
  },
  gpuPillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  gpuPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  gpuPillText: {
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foreground,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotOk: {
    backgroundColor: theme.colors.statusSuccess,
  },
  dotWarn: {
    backgroundColor: theme.colors.statusWarning,
  },
  dotOff: {
    backgroundColor: theme.colors.statusDanger,
  },
  errorBanner: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.statusDangerTint,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.statusDanger,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  subBar: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  chip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 5,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  chipActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  chipText: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  chipTextActive: {
    color: theme.colors.accentForeground,
    fontWeight: theme.fontWeight.semibold,
  },
  agentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
    maxWidth: 260,
  },
  agentChipBadge: {
    fontSize: 10,
    fontFamily: theme.fontFamily.mono,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.accent,
  },
  agentChipTitle: {
    fontSize: 12,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  scroll: {
    flex: 1,
  },
  feedContent: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  gpuContent: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  gpuGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  card: {
    flexGrow: 1,
    minWidth: 260,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3.5],
    gap: theme.spacing[1.5],
  },
  cardTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foreground,
  },
  cardActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  kvLine: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  emptyCard: {
    padding: theme.spacing[6],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  msgCard: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accent,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  msgUser: {
    backgroundColor: theme.colors.surface2,
    borderLeftColor: theme.colors.accentBright,
  },
  msgSub: {
    marginLeft: theme.spacing[4],
    borderLeftColor: theme.colors.statusSuccess,
  },
  msgHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  msgAuthorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  msgAuthor: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foreground,
  },
  msgBody: {
    fontSize: theme.fontSize.base,
    lineHeight: 21,
    color: theme.colors.foreground,
  },
  badgePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
  },
  badgeAccent: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  badgeOk: {
    backgroundColor: theme.colors.statusSuccessTint,
    borderColor: theme.colors.statusSuccess,
  },
  badgeWarn: {
    backgroundColor: theme.colors.statusWarningTint,
    borderColor: theme.colors.statusWarning,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: theme.fontFamily.mono,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.accentBright,
  },
  badgeAccentText: {
    color: theme.colors.accentForeground,
  },
  badgeOkText: {
    color: theme.colors.statusSuccess,
  },
  badgeWarnText: {
    color: theme.colors.statusWarning,
  },
  detailBox: {
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
    gap: theme.spacing[1],
  },
  mutedText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  monoMuted: {
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  monoLink: {
    fontSize: 11,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.accent,
  },
  monoBlock: {
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foreground,
    lineHeight: 18,
  },
  composer: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
  composerInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  feedbackText: {
    fontSize: 12,
    color: theme.colors.accentBright,
  },
  sep: {
    width: 1,
    height: 18,
    backgroundColor: theme.colors.border,
    marginHorizontal: 4,
  },
}));
