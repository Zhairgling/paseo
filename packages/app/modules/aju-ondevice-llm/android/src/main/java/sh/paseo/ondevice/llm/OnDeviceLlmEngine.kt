package sh.paseo.ondevice.llm

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ThinkingConfig

internal class OnDeviceLlmEngine(
  private val context: Context,
) {
  private val engineLock = Any()
  private var loadedModelId: String? = null
  private var engine: Engine? = null

  fun preload(modelId: String) {
    synchronized(engineLock) {
      ensureEngineLocked(modelId)
    }
  }

  fun release(modelId: String? = null) {
    synchronized(engineLock) {
      if (modelId == null || modelId == loadedModelId) {
        try {
          engine?.close()
        } catch (_: Throwable) {}
        engine = null
        loadedModelId = null
      }
    }
  }

  fun reprompt(modelId: String, mode: String, draftText: String): String {
    val trimmed = draftText.trim()
    if (trimmed.isEmpty()) return draftText

    val systemInstruction = when (mode) {
      "enhance" -> ENHANCE_SYSTEM_PROMPT
      else -> FIX_SYSTEM_PROMPT
    }
    val temperature = if (mode == "enhance") 0.35 else 0.15

    synchronized(engineLock) {
      val currentEngine = ensureEngineLocked(modelId)
      val conversationConfig = ConversationConfig(
        systemInstruction = Contents.of(systemInstruction),
        samplerConfig = SamplerConfig(
          topK = 24,
          topP = 0.85,
          temperature = temperature,
          seed = 42,
        ),
        thinkingConfig = ThinkingConfig(enableThinking = false),
      )
      currentEngine.createConversation(conversationConfig).use { conversation ->
        val response = conversation.sendMessage("<brouillon>\n$trimmed\n</brouillon>")
        val text = response.contents.contents
          .filterIsInstance<Content.Text>()
          .joinToString("") { it.text }
          .trim()
        return if (text.isNotEmpty()) text else trimmed
      }
    }
  }

  private fun ensureEngineLocked(modelId: String): Engine {
    val existing = engine
    if (existing != null && loadedModelId == modelId && existing.isInitialized()) {
      return existing
    }
    if (existing != null) {
      try {
        existing.close()
      } catch (_: Throwable) {}
      engine = null
      loadedModelId = null
    }

    val modelFile = OnDeviceLlmCatalog.modelFile(context, modelId)
      ?: throw IllegalArgumentException("Modèle inconnu: $modelId")
    if (!OnDeviceLlmCatalog.isModelReady(context, modelId)) {
      throw IllegalStateException("Modèle $modelId non téléchargé")
    }

    val cacheDir = context.cacheDir.absolutePath
    val created = try {
      Engine(
        EngineConfig(
          modelPath = modelFile.absolutePath,
          backend = Backend.GPU(),
          maxNumTokens = 2048,
          cacheDir = cacheDir,
        ),
      ).also { it.initialize() }
    } catch (_: Throwable) {
      Engine(
        EngineConfig(
          modelPath = modelFile.absolutePath,
          backend = Backend.CPU(),
          maxNumTokens = 2048,
          cacheDir = cacheDir,
        ),
      ).also { it.initialize() }
    }

    engine = created
    loadedModelId = modelId
    return created
  }

  companion object {
    private val FIX_SYSTEM_PROMPT = """
      Tu es un éditeur spécialisé dans le nettoyage de dictée vocale brute de développeur.
      À partir du brouillon dicté à la voix :
      1. Supprime les hésitations et tics de langage ("euh", "ben", "du coup", "en fait", "tu vois", "genre"), les bégaiements et répétitions.
      2. Si l'utilisateur se reprend en plein milieu de phrase ("enfin non plutôt...", "pardon pas X mais Y"), ne garde que sa version finale corrigée.
      3. Corrige l'orthographe, la grammaire, la ponctuation et les mots mal transcrits phonétiquement par la reconnaissance vocale.
      4. Garde le sens exact et le style direct sans rallonger inutilement, et ne modifie jamais les chemins de fichiers, @mentions, /commandes, URLs, blocs de code ou identifiants techniques.
      Réponds UNIQUEMENT par le message final propre, sans commentaire, sans balise ni guillemets ajoutés.
    """.trimIndent()

    private val ENHANCE_SYSTEM_PROMPT = """
      Tu transformes un brouillon dicté vite à la voix (souvent brouillon, avec hésitations, digressions ou descriptions floues) en un prompt clair, structuré et ultra-efficace pour un agent de code IA.
      À partir du brouillon :
      1. Supprime toutes les hésitations ("euh", "tu vois", "en fait", "du coup"), répétitions et faux départs ; garde uniquement la vraie intention finale quand la personne se corrige en parlant.
      2. Clarifie et reformule les descriptions confuses en instructions précises, logiques et directement actionnables (phrases courtes ou liste à puces si plusieurs demandes).
      3. Conserve strictement l'intention d'origine, la langue du brouillon, ainsi que tous les chemins de fichiers, @mentions, /commandes, URLs et identifiants techniques. N'invente aucune exigence non exprimée.
      Réponds UNIQUEMENT par le prompt amélioré final, sans introduction, sans balise ni commentaire.
    """.trimIndent()
  }
}
