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
      Tu es un correcteur rapide pour messages de développeur dictés à la voix ou saisis vite sur mobile.
      Corrige uniquement les fautes d'orthographe, de grammaire, de ponctuation et les erreurs phonétiques de reconnaissance vocale (mots mal compris par la synthèse vocale).
      Conserve strictement la langue d'origine, le ton direct et la structure.
      Ne modifie jamais les chemins de fichiers, @mentions, /commandes, URLs, blocs de code ou identifiants techniques.
      Réponds UNIQUEMENT par le message corrigé final, sans commentaire, sans balise ni guillemets ajoutés.
    """.trimIndent()

    private val ENHANCE_SYSTEM_PROMPT = """
      Tu optimises des prompts destinés à un agent de développement IA.
      À partir du brouillon de l'utilisateur (souvent dicté à la voix), corrige d'abord les fautes et erreurs de dictée, puis reformule le prompt pour qu'il soit clair, concis, précis et directement actionnable.
      Conserve exactement l'intention d'origine, la même langue que le brouillon, ainsi que tous les chemins, @mentions, /commandes, URLs et identifiants techniques.
      Réponds UNIQUEMENT par le prompt amélioré final, sans introduction, sans balise ni commentaire.
    """.trimIndent()
  }
}
