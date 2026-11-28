import { Copy, Plus, Rocket, Save, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  homelabFetchJson,
  type ColabGpuTier,
  type DaemonHttpTarget,
  type HomelabCatalogResponse,
  type HomelabLaunchResponse,
  type HomelabTemplatesResponse,
  type McpTemplate,
  type QuantOption,
  type ScenarioTemplate,
  type SkillTemplate,
  type TemplateUniverse,
} from "./api";

type TemplateKind = "scenarios" | "skills" | "mcps";

function PillButton<T extends string>({
  value,
  label,
  active,
  disabled,
  onPress,
}: {
  value: T;
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: (val: T) => void;
}) {
  const handlePress = useCallback(() => {
    if (!disabled) onPress(value);
  }, [disabled, onPress, value]);

  return (
    <PressHighlight
      onPress={handlePress}
      style={[styles.pill, active && styles.pillActive, disabled && styles.pillDisabled]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </PressHighlight>
  );
}

export function selectCheapestGpuClient(
  providers: HomelabCatalogResponse["providers"],
  gpuTiers: HomelabCatalogResponse["gpuTiers"],
  modelId: string,
  quant: QuantOption,
): ColabGpuTier {
  const spec = providers.find((p) => p.universe === "colab" && p.modelId === modelId);
  const vram = spec?.vramGbByQuant[quant] ?? spec?.vramGbByQuant[spec.defaultQuant] ?? 52;
  const needed = vram + 8;
  for (const tier of gpuTiers) {
    if (tier.vramGb >= needed) return tier.tier;
  }
  return "G4";
}

function ScenarioColabOptions({
  activeProviderSpec,
  quant,
  gpuTier,
  gpuTiers,
  onSelectQuant,
  onSelectGpuTier,
}: {
  activeProviderSpec: HomelabCatalogResponse["providers"][number] | undefined;
  quant: QuantOption;
  gpuTier: ColabGpuTier;
  gpuTiers: HomelabCatalogResponse["gpuTiers"];
  onSelectQuant: (q: QuantOption) => void;
  onSelectGpuTier: (t: ColabGpuTier) => void;
}) {
  if (!activeProviderSpec) return null;
  return (
    <>
      <Text style={styles.label}>Quantification & GPU le moins cher compatible</Text>
      <View style={styles.rowWrap}>
        {activeProviderSpec.supportedQuants.map((q) => (
          <PillButton key={q} value={q} label={q} active={quant === q} onPress={onSelectQuant} />
        ))}
        {gpuTiers.map((tier) => (
          <PillButton
            key={tier.tier}
            value={tier.tier}
            label={tier.label}
            active={gpuTier === tier.tier}
            onPress={onSelectGpuTier}
          />
        ))}
      </View>
    </>
  );
}

function ScenarioInjectionsSection({
  availableSkills,
  availableMcps,
  skillIds,
  mcpIds,
  onToggleSkill,
  onToggleMcp,
}: {
  availableSkills: SkillTemplate[];
  availableMcps: McpTemplate[];
  skillIds: string[];
  mcpIds: string[];
  onToggleSkill: (id: string) => void;
  onToggleMcp: (id: string) => void;
}) {
  return (
    <>
      {availableSkills.length > 0 ? (
        <>
          <Text style={styles.label}>Skills injectés</Text>
          <View style={styles.rowWrap}>
            {availableSkills.map((sk) => (
              <PillButton
                key={sk.id}
                value={sk.id}
                label={sk.name}
                active={skillIds.includes(sk.id)}
                onPress={onToggleSkill}
              />
            ))}
          </View>
        </>
      ) : null}

      {availableMcps.length > 0 ? (
        <>
          <Text style={styles.label}>Outils MCP actifs</Text>
          <View style={styles.rowWrap}>
            {availableMcps.map((m) => (
              <PillButton
                key={m.id}
                value={m.id}
                label={m.name}
                active={mcpIds.includes(m.id)}
                onPress={onToggleMcp}
              />
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

export function HomelabScenarioLauncher({
  target,
  lockedUniverse,
  cwd,
  colabUsedSlots,
  maxColabSlots = 2,
  onLaunched,
}: {
  target: DaemonHttpTarget;
  lockedUniverse?: TemplateUniverse;
  cwd?: string;
  colabUsedSlots: number;
  maxColabSlots?: number;
  onLaunched?: (msg: string) => void;
}): ReactElement {
  const [universe, setUniverse] = useState<TemplateUniverse>(lockedUniverse ?? "colab");
  const [catalog, setCatalog] = useState<HomelabCatalogResponse | null>(null);
  const [templates, setTemplates] = useState<HomelabTemplatesResponse | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
  const [providerModelKey, setProviderModelKey] = useState<string>("");
  const [quant, setQuant] = useState<QuantOption>("Q4_K_M");
  const [gpuTier, setGpuTier] = useState<ColabGpuTier>("A100");
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [mcpIds, setMcpIds] = useState<string[]>([]);
  const [taskTitle, setTaskTitle] = useState<string>("");
  const [taskPrompt, setTaskPrompt] = useState<string>("");
  const [launchResetCount, setLaunchResetCount] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (lockedUniverse) {
      setUniverse(lockedUniverse);
    }
  }, [lockedUniverse]);

  const loadData = useCallback(async () => {
    try {
      const [cat, tpl] = await Promise.all([
        homelabFetchJson<HomelabCatalogResponse>(target, "/api/homelab/catalog"),
        homelabFetchJson<HomelabTemplatesResponse>(target, "/api/homelab/templates"),
      ]);
      setCatalog(cat);
      setTemplates(tpl);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur chargement catalogue/templates");
    }
  }, [target]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const scenariosForUniverse = useMemo(
    () => (templates?.scenarios ?? []).filter((s) => s.universe === universe),
    [templates?.scenarios, universe],
  );

  const providersForUniverse = useMemo(
    () => (catalog?.providers ?? []).filter((p) => p.universe === universe),
    [catalog?.providers, universe],
  );

  const applyScenario = useCallback(
    (scenario: ScenarioTemplate) => {
      setSelectedScenarioId(scenario.id);
      setProviderModelKey(`${scenario.providerId}::${scenario.modelId}`);
      setQuant(scenario.quant);
      if (scenario.gpuTier) {
        setGpuTier(scenario.gpuTier);
      } else if (catalog) {
        setGpuTier(
          selectCheapestGpuClient(
            catalog.providers,
            catalog.gpuTiers,
            scenario.modelId,
            scenario.quant,
          ),
        );
      }
      setSystemPrompt(scenario.systemPrompt);
      setSkillIds(scenario.skillIds);
      setMcpIds(scenario.mcpIds);
    },
    [catalog],
  );

  useEffect(() => {
    if (
      scenariosForUniverse.length > 0 &&
      !scenariosForUniverse.some((s) => s.id === selectedScenarioId)
    ) {
      applyScenario(scenariosForUniverse[0]!);
    }
  }, [applyScenario, scenariosForUniverse, selectedScenarioId]);

  const activeProviderSpec = useMemo(
    () =>
      providersForUniverse.find((p) => `${p.providerId}::${p.modelId}` === providerModelKey) ??
      providersForUniverse[0],
    [providerModelKey, providersForUniverse],
  );

  const handleSelectProvider = useCallback(
    (specId: string) => {
      const spec = providersForUniverse.find((p) => p.id === specId);
      if (!spec) return;
      setProviderModelKey(`${spec.providerId}::${spec.modelId}`);
      setQuant(spec.defaultQuant);
      if (spec.universe === "colab" && catalog) {
        setGpuTier(
          selectCheapestGpuClient(
            catalog.providers,
            catalog.gpuTiers,
            spec.modelId,
            spec.defaultQuant,
          ),
        );
      }
    },
    [catalog, providersForUniverse],
  );

  const handleSelectQuant = useCallback(
    (q: QuantOption) => {
      setQuant(q);
      if (universe === "colab" && activeProviderSpec && catalog) {
        setGpuTier(
          selectCheapestGpuClient(
            catalog.providers,
            catalog.gpuTiers,
            activeProviderSpec.modelId,
            q,
          ),
        );
      }
    },
    [activeProviderSpec, catalog, universe],
  );

  const toggleSkill = useCallback((id: string) => {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleMcp = useCallback((id: string) => {
    setMcpIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const colabBlocked = universe === "colab" && colabUsedSlots >= maxColabSlots;

  const handleLaunch = useCallback(async () => {
    if (!activeProviderSpec || !taskPrompt.trim()) {
      setErrorMsg("Saisis la consigne de tâche avant de lancer.");
      return;
    }
    setLaunching(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const res = await homelabFetchJson<HomelabLaunchResponse>(target, "/api/homelab/launch", {
        method: "POST",
        body: {
          universe,
          providerId: activeProviderSpec.providerId,
          modelId: activeProviderSpec.modelId,
          quant,
          gpuTier: universe === "colab" ? gpuTier : undefined,
          systemPrompt,
          skillIds,
          mcpIds,
          prompt: taskPrompt.trim(),
          cwd,
          title: taskTitle.trim() || undefined,
        },
      });
      const msg =
        universe === "colab"
          ? `Agent Colab lancé (${res.gpuTier ?? gpuTier} · ${res.quant})`
          : `Agent local lancé (${activeProviderSpec.label})`;
      setStatusMsg(msg);
      setTaskPrompt("");
      setTaskTitle("");
      setLaunchResetCount((c) => c + 1);
      onLaunched?.(msg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Échec du lancement");
    } finally {
      setLaunching(false);
    }
  }, [
    activeProviderSpec,
    cwd,
    gpuTier,
    mcpIds,
    onLaunched,
    quant,
    skillIds,
    systemPrompt,
    target,
    taskPrompt,
    taskTitle,
    universe,
  ]);

  const availableSkills = useMemo(
    () => (templates?.skills ?? []).filter((s) => s.scope === "both" || s.scope === universe),
    [templates?.skills, universe],
  );
  const availableMcps = useMemo(
    () => (templates?.mcps ?? []).filter((m) => m.scope === "both" || m.scope === universe),
    [templates?.mcps, universe],
  );

  const handleSelectScenario = useCallback(
    (id: string) => {
      const found = scenariosForUniverse.find((s) => s.id === id);
      if (found) applyScenario(found);
    },
    [applyScenario, scenariosForUniverse],
  );

  let launchLabel = "Lancer en Local";
  if (launching) {
    launchLabel = "Lancement…";
  } else if (universe === "colab") {
    launchLabel = `Lancer sur Colab (${gpuTier} · ${quant})`;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>
        {universe === "colab"
          ? `Lancer sur Colab GPU (${colabUsedSlots}/${maxColabSlots} slots · Zéro délégation locale)`
          : "Lancer en Local / Cloud (isolé de Colab)"}
      </Text>

      {!lockedUniverse ? (
        <View style={styles.rowWrap}>
          <PillButton
            value="colab"
            label="Colab GPU"
            active={universe === "colab"}
            onPress={setUniverse}
          />
          <PillButton
            value="local"
            label="Local & Cloud"
            active={universe === "local"}
            onPress={setUniverse}
          />
        </View>
      ) : null}

      <Text style={styles.label}>Scénario préconfiguré</Text>
      <View style={styles.rowWrap}>
        {scenariosForUniverse.map((scn) => (
          <PillButton
            key={scn.id}
            value={scn.id}
            label={scn.name}
            active={selectedScenarioId === scn.id}
            onPress={handleSelectScenario}
          />
        ))}
      </View>

      <Text style={styles.label}>Prestataire & Modèle</Text>
      <View style={styles.rowWrap}>
        {providersForUniverse.map((spec) => (
          <PillButton
            key={spec.id}
            value={spec.id}
            label={spec.label}
            active={activeProviderSpec?.id === spec.id}
            onPress={handleSelectProvider}
          />
        ))}
      </View>

      {universe === "colab" ? (
        <ScenarioColabOptions
          activeProviderSpec={activeProviderSpec}
          quant={quant}
          gpuTier={gpuTier}
          gpuTiers={catalog?.gpuTiers ?? []}
          onSelectQuant={handleSelectQuant}
          onSelectGpuTier={setGpuTier}
        />
      ) : null}

      <Text style={styles.label}>Prompt système (prérempli, modifiable à la volée)</Text>
      <AdaptiveTextInput
        initialValue={systemPrompt}
        resetKey={selectedScenarioId}
        onChangeText={setSystemPrompt}
        multiline
        placeholder="Consignes système de l'agent..."
        style={styles.textArea}
      />

      <ScenarioInjectionsSection
        availableSkills={availableSkills}
        availableMcps={availableMcps}
        skillIds={skillIds}
        mcpIds={mcpIds}
        onToggleSkill={toggleSkill}
        onToggleMcp={toggleMcp}
      />

      <AdaptiveTextInput
        initialValue={taskTitle}
        resetKey={launchResetCount}
        onChangeText={setTaskTitle}
        placeholder="Titre session (optionnel)"
        style={styles.input}
      />
      <AdaptiveTextInput
        initialValue={taskPrompt}
        resetKey={launchResetCount}
        onChangeText={setTaskPrompt}
        multiline
        placeholder="Mission à confier à cet agent..."
        style={styles.textArea}
      />

      {colabBlocked ? (
        <Text style={styles.errorText}>
          {`Verrou Colab actif : ${colabUsedSlots}/${maxColabSlots} slots occupés.`}
        </Text>
      ) : null}
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      {statusMsg ? <Text style={styles.okText}>{statusMsg}</Text> : null}

      <Button
        variant="default"
        size="sm"
        leftIcon={Rocket}
        disabled={launching || colabBlocked}
        onPress={handleLaunch}
      >
        {launchLabel}
      </Button>
    </View>
  );
}

export function HomelabTemplatesCrudPanel({ target }: { target: DaemonHttpTarget }): ReactElement {
  const [kind, setKind] = useState<TemplateKind>("scenarios");
  const [data, setData] = useState<HomelabTemplatesResponse | null>(null);
  const [catalog, setCatalog] = useState<HomelabCatalogResponse | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Shared draft fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [universe, setUniverse] = useState<TemplateUniverse>("colab");
  const [modelId, setModelId] = useState("colab/qwen3-coder-next");
  const [providerId, setProviderId] = useState("opencode");
  const [quant, setQuant] = useState<QuantOption>("Q4_K_M");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [scope, setScope] = useState<"both" | TemplateUniverse>("both");
  const [skillContent, setSkillContent] = useState("");
  const [mcpServerName, setMcpServerName] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"http" | "stdio">("http");
  const [mcpTarget, setMcpTarget] = useState("");
  const [feedback, setFeedback] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [tpl, cat] = await Promise.all([
        homelabFetchJson<HomelabTemplatesResponse>(target, "/api/homelab/templates"),
        homelabFetchJson<HomelabCatalogResponse>(target, "/api/homelab/catalog"),
      ]);
      setData(tpl);
      setCatalog(cat);
      setErrorMsg("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lecture templates");
    }
  }, [target]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const [formResetKey, setFormResetKey] = useState(0);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setName("");
    setDescription("");
    setUniverse("colab");
    setProviderId("opencode");
    setModelId("colab/qwen3-coder-next");
    setQuant("Q4_K_M");
    setSystemPrompt("");
    setScope("both");
    setSkillContent("");
    setMcpServerName("");
    setMcpTransport("http");
    setMcpTarget("");
    setFormResetKey((k) => k + 1);
  }, []);

  const loadScenarioToForm = useCallback((s: ScenarioTemplate) => {
    setEditingId(s.id);
    setName(s.name);
    setDescription(s.description);
    setUniverse(s.universe);
    setProviderId(s.providerId);
    setModelId(s.modelId);
    setQuant(s.quant);
    setSystemPrompt(s.systemPrompt);
    setFormResetKey((k) => k + 1);
  }, []);

  const loadSkillToForm = useCallback((s: SkillTemplate) => {
    setEditingId(s.id);
    setName(s.name);
    setDescription(s.description);
    setScope(s.scope);
    setSkillContent(s.content);
    setFormResetKey((k) => k + 1);
  }, []);

  const loadMcpToForm = useCallback((m: McpTemplate) => {
    setEditingId(m.id);
    setName(m.name);
    setDescription(m.description);
    setScope(m.scope);
    setMcpServerName(m.serverName);
    setMcpTransport(m.transport);
    setMcpTarget(m.target);
    setFormResetKey((k) => k + 1);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setErrorMsg("Le nom est requis.");
      return;
    }
    let body: Record<string, unknown> = {};
    if (kind === "scenarios") {
      body = {
        name: name.trim(),
        description: description.trim(),
        universe,
        providerId,
        modelId,
        quant,
        gpuTier:
          universe === "colab" && catalog
            ? selectCheapestGpuClient(catalog.providers, catalog.gpuTiers, modelId, quant)
            : undefined,
        systemPrompt,
        skillIds: [],
        mcpIds: [],
      };
    } else if (kind === "skills") {
      body = {
        name: name.trim(),
        description: description.trim(),
        content: skillContent,
        scope,
      };
    } else {
      body = {
        name: name.trim(),
        serverName: mcpServerName.trim() || name.trim().toLowerCase().replace(/\s+/g, "-"),
        description: description.trim(),
        transport: mcpTransport,
        target: mcpTarget.trim(),
        scope,
        enabledByDefault: true,
      };
    }

    try {
      const url = editingId
        ? `/api/homelab/templates/${kind}/${encodeURIComponent(editingId)}`
        : `/api/homelab/templates/${kind}`;
      const res = await homelabFetchJson<HomelabTemplatesResponse>(target, url, {
        method: editingId ? "PUT" : "POST",
        body,
      });
      setData(res);
      setFeedback(editingId ? "Template mis à jour." : "Template créé.");
      resetForm();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur sauvegarde template");
    }
  }, [
    catalog,
    description,
    editingId,
    kind,
    mcpServerName,
    mcpTarget,
    mcpTransport,
    modelId,
    name,
    providerId,
    quant,
    resetForm,
    scope,
    skillContent,
    systemPrompt,
    target,
    universe,
  ]);

  const handleDuplicate = useCallback(
    async (id: string) => {
      try {
        const res = await homelabFetchJson<HomelabTemplatesResponse>(
          target,
          `/api/homelab/templates/${kind}/${encodeURIComponent(id)}/duplicate`,
          { method: "POST" },
        );
        setData(res);
        setFeedback("Template dupliqué.");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Erreur duplication");
      }
    },
    [kind, target],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await homelabFetchJson<HomelabTemplatesResponse>(
          target,
          `/api/homelab/templates/${kind}/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        setData(res);
        if (editingId === id) resetForm();
        setFeedback("Template supprimé.");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Erreur suppression");
      }
    },
    [editingId, kind, resetForm, target],
  );

  const handleSelectKind = useCallback(
    (nextKind: TemplateKind) => {
      setKind(nextKind);
      resetForm();
    },
    [resetForm],
  );

  const handleSelectTemplateProvider = useCallback(
    (specId: string) => {
      const found = (catalog?.providers ?? []).find((p) => p.id === specId);
      if (!found) return;
      setProviderId(found.providerId);
      setModelId(found.modelId);
      setQuant(found.defaultQuant);
    },
    [catalog?.providers],
  );

  const handleEditItem = useCallback(
    (item: ScenarioTemplate | SkillTemplate | McpTemplate) => {
      if (kind === "scenarios") loadScenarioToForm(item as ScenarioTemplate);
      if (kind === "skills") loadSkillToForm(item as SkillTemplate);
      if (kind === "mcps") loadMcpToForm(item as McpTemplate);
    },
    [kind, loadMcpToForm, loadScenarioToForm, loadSkillToForm],
  );

  const items = data ? data[kind] : [];

  return (
    <View style={styles.crudWrap}>
      <View style={styles.rowWrap}>
        <PillButton
          value="scenarios"
          label="Scénarios & Prompts"
          active={kind === "scenarios"}
          onPress={handleSelectKind}
        />
        <PillButton
          value="skills"
          label="Skills"
          active={kind === "skills"}
          onPress={handleSelectKind}
        />
        <PillButton
          value="mcps"
          label="Outils MCP"
          active={kind === "mcps"}
          onPress={handleSelectKind}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>
            {editingId ? "Modifier le template" : "Créer un template"}
          </Text>
          {editingId ? (
            <Button size="sm" variant="ghost" leftIcon={Plus} onPress={resetForm}>
              Nouveau
            </Button>
          ) : null}
        </View>

        <AdaptiveTextInput
          initialValue={name}
          resetKey={formResetKey}
          onChangeText={setName}
          placeholder="Nom"
          style={styles.input}
        />
        <AdaptiveTextInput
          initialValue={description}
          resetKey={formResetKey}
          onChangeText={setDescription}
          placeholder="Description courte"
          style={styles.input}
        />

        {kind === "scenarios" ? (
          <>
            <View style={styles.rowWrap}>
              <PillButton
                value="colab"
                label="Colab GPU"
                active={universe === "colab"}
                onPress={setUniverse}
              />
              <PillButton
                value="local"
                label="Local / Cloud"
                active={universe === "local"}
                onPress={setUniverse}
              />
            </View>
            <View style={styles.rowWrap}>
              {(catalog?.providers ?? [])
                .filter((p) => p.universe === universe)
                .map((p) => (
                  <PillButton
                    key={p.id}
                    value={p.id}
                    label={p.label}
                    active={modelId === p.modelId}
                    onPress={handleSelectTemplateProvider}
                  />
                ))}
            </View>
            <AdaptiveTextInput
              initialValue={systemPrompt}
              resetKey={formResetKey}
              onChangeText={setSystemPrompt}
              multiline
              placeholder="Prompt système prérempli..."
              style={styles.textArea}
            />
          </>
        ) : null}

        {kind === "skills" ? (
          <>
            <View style={styles.rowWrap}>
              <PillButton
                value="both"
                label="Colab + Local"
                active={scope === "both"}
                onPress={setScope}
              />
              <PillButton
                value="colab"
                label="Colab seul"
                active={scope === "colab"}
                onPress={setScope}
              />
              <PillButton
                value="local"
                label="Local seul"
                active={scope === "local"}
                onPress={setScope}
              />
            </View>
            <AdaptiveTextInput
              initialValue={skillContent}
              resetKey={formResetKey}
              onChangeText={setSkillContent}
              multiline
              placeholder="Instructions du skill injectées au lancement..."
              style={styles.textArea}
            />
          </>
        ) : null}

        {kind === "mcps" ? (
          <>
            <AdaptiveTextInput
              initialValue={mcpServerName}
              resetKey={formResetKey}
              onChangeText={setMcpServerName}
              placeholder="serverName (ex: homelab, osint)"
              style={styles.input}
            />
            <View style={styles.rowWrap}>
              <PillButton
                value="http"
                label="HTTP"
                active={mcpTransport === "http"}
                onPress={setMcpTransport}
              />
              <PillButton
                value="stdio"
                label="Stdio"
                active={mcpTransport === "stdio"}
                onPress={setMcpTransport}
              />
              <PillButton
                value="both"
                label="Colab + Local"
                active={scope === "both"}
                onPress={setScope}
              />
              <PillButton
                value="local"
                label="Local seul"
                active={scope === "local"}
                onPress={setScope}
              />
            </View>
            <AdaptiveTextInput
              initialValue={mcpTarget}
              resetKey={formResetKey}
              onChangeText={setMcpTarget}
              placeholder="URL MCP ou commande stdio"
              style={styles.input}
            />
          </>
        ) : null}

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
        {feedback ? <Text style={styles.okText}>{feedback}</Text> : null}

        <Button size="sm" variant="default" leftIcon={Save} onPress={handleSave}>
          {editingId ? "Enregistrer" : "Créer"}
        </Button>
      </View>

      {items.map((item) => (
        <TemplateListItemCard
          key={item.id}
          item={item}
          onEdit={handleEditItem}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
        />
      ))}
    </View>
  );
}

function TemplateListItemCard({
  item,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: ScenarioTemplate | SkillTemplate | McpTemplate;
  onEdit: (item: ScenarioTemplate | SkillTemplate | McpTemplate) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const handleEditPress = useCallback(() => {
    onEdit(item);
  }, [item, onEdit]);

  const handleDuplicatePress = useCallback(() => {
    void onDuplicate(item.id);
  }, [item.id, onDuplicate]);

  const handleDeletePress = useCallback(() => {
    void onDelete(item.id);
  }, [item.id, onDelete]);

  return (
    <View style={styles.card}>
      <Text style={styles.itemTitle}>{item.name}</Text>
      {item.description ? <Text style={styles.itemHint}>{item.description}</Text> : null}
      <View style={styles.rowWrap}>
        <Button size="sm" variant="outline" onPress={handleEditPress}>
          Modifier
        </Button>
        <Button size="sm" variant="ghost" leftIcon={Copy} onPress={handleDuplicatePress}>
          Dupliquer
        </Button>
        <Button size="sm" variant="ghost" leftIcon={Trash2} onPress={handleDeletePress}>
          Supprimer
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  crudWrap: {
    gap: theme.spacing[3],
  },
  card: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[2],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  rowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  pillActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  pillDisabled: {
    opacity: 0.45,
  },
  pillText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  pillTextActive: {
    color: theme.colors.accentForeground,
    fontWeight: theme.fontWeight.semibold,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.background,
  },
  textArea: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    minHeight: 72,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.background,
  },
  itemTitle: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
  },
  itemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  okText: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.sm,
  },
}));
