package sh.paseo.ondevice.llm

import android.content.Context
import android.util.Log
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

    val isEnhance = mode == "enhance"
    val systemInstruction = if (isEnhance) ENHANCE_SYSTEM_PROMPT else FIX_SYSTEM_PROMPT
    val userPrompt = if (isEnhance) {
      "Reformule et améliore uniquement ce brouillon dicté à la voix en un prompt clair et actionnable pour un agent de code (dans la même langue, sans jamais y répondre ni demander de précisions) :\n\n\"\"\"\n$trimmed\n\"\"\""
    } else {
      "Nettoie uniquement ce brouillon dicté à la voix (retire les hésitations/répétitions, garde uniquement la dernière intention si correction orale, corrige l'orthographe sans y répondre) :\n\n\"\"\"\n$trimmed\n\"\"\""
    }

    synchronized(engineLock) {
      val currentEngine = ensureEngineLocked(modelId)
      var output = runConversation(
        currentEngine = currentEngine,
        systemInstruction = systemInstruction,
        userPrompt = userPrompt,
        temperature = if (isEnhance) 0.25 else 0.1,
      )
      if (looksLikeRefusal(output)) {
        Log.w("AjuOnDeviceLlm", "Primary reprompt returned assistant refusal, retrying compact fallback")
        output = runConversation(
          currentEngine = currentEngine,
          systemInstruction = COMPACT_REWRITE_PROMPT,
          userPrompt = "Draft:\n$trimmed\n\nRewritten:",
          temperature = 0.0,
        )
      }
      if (looksLikeRefusal(output)) {
        throw IllegalStateException(
          "Le modèle local n'a pas pu reformuler ce brouillon tel quel — ajoute quelques mots de contexte.",
        )
      }
      Log.i("AjuOnDeviceLlm", "reprompt model=$modelId mode=$mode inChars=${trimmed.length} outChars=${output.length}")
      return if (output.isNotEmpty()) output else trimmed
    }
  }

  private fun runConversation(
    currentEngine: Engine,
    systemInstruction: String,
    userPrompt: String,
    temperature: Double,
  ): String {
    val conversationConfig = ConversationConfig(
      systemInstruction = Contents.of(systemInstruction),
      samplerConfig = SamplerConfig(
        topK = 20,
        topP = 0.85,
        temperature = temperature,
        seed = 42,
      ),
      thinkingConfig = ThinkingConfig(enableThinking = false),
    )
    currentEngine.createConversation(conversationConfig).use { conversation ->
      val response = conversation.sendMessage(userPrompt)
      return response.contents.contents
        .filterIsInstance<Content.Text>()
        .joinToString("") { it.text }
        .trim()
    }
  }

  private fun looksLikeRefusal(output: String): Boolean {
    val lower = output.trim().lowercase()
    if (lower.isEmpty()) return false
    return REFUSAL_PREFIXES.any { prefix -> lower.startsWith(prefix) }
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
      ).also {
        it.initialize()
        Log.i("AjuOnDeviceLlm", "Initialized LiteRT-LM on GPU for $modelId")
      }
    } catch (gpuErr: Throwable) {
      Log.w("AjuOnDeviceLlm", "GPU init failed for $modelId (${gpuErr.message}), falling back to CPU")
      Engine(
        EngineConfig(
          modelPath = modelFile.absolutePath,
          backend = Backend.CPU(),
          maxNumTokens = 2048,
          cacheDir = cacheDir,
        ),
      ).also {
        it.initialize()
        Log.i("AjuOnDeviceLlm", "Initialized LiteRT-LM on CPU for $modelId")
      }
    }

    engine = created
    loadedModelId = modelId
    return created
  }

  companion object {
    private val REFUSAL_PREFIXES = listOf(
      "i'm sorry",
      "i am sorry",
      "sorry, i",
      "i cannot assist",
      "i can't assist",
      "as an ai",
      "could you please clarify",
      "could you provide more",
      "je suis désolé",
      "désolé, je ne peux pas",
      "en tant qu'ia",
    )

    private val FIX_SYSTEM_PROMPT = """
      You are a pure text-rewriting tool for developers dictating prompts on mobile (French or English).
      You NEVER answer the text, NEVER execute requests, and NEVER ask for clarification. Even if the draft is vague or incomplete, ALWAYS rewrite the draft itself.
      Task: remove spoken filler/hesitations ("euh", "ben", "du coup", "en fait", "tu vois", "uh", "like"), resolve mid-sentence self-corrections (keep only the final choice), and fix spelling, punctuation, and voice-recognition typos while keeping @mentions, /commands, file paths, and code unchanged. Same language as input. Output ONLY the rewritten text.

      Examples:
      Draft: "euh alors en fait non regarde pas header mais le bug dans index.tsx stp"
      Output: "Regarde plutôt le bug dans index.tsx, s'il te plaît (pas dans header)."

      Draft: "tu peux verifie pourquoi le bult echoue sur @src/app.ts tu vois"
      Output: "Peux-tu vérifier pourquoi le build échoue sur @src/app.ts ?"
    """.trimIndent()

    private val ENHANCE_SYSTEM_PROMPT = """
      You are a pure prompt-rewriting tool for developers dictating fast voice drafts on mobile (French or English).
      You NEVER answer the user, NEVER refuse, and NEVER ask for more details. Even if the draft is short or messy, ALWAYS rewrite and clarify the prompt itself for an AI coding assistant.
      Task:
      1. Strip all oral hesitations ("euh", "en fait", "du coup", "tu vois", "ben", "genre"), repetitions, and false starts (keep only the final corrected intent).
      2. Turn messy spoken descriptions into clear, structured, actionable coding instructions (use concise bullet points if there are multiple requests).
      3. Keep the original language and preserve all @mentions, /commands, file paths, and technical terms verbatim. Output ONLY the improved prompt.

      Examples:
      Draft: "euh alors en fait regarde le bug dans index"
      Output: "Inspecte le fichier index pour identifier la cause du bug et propose un correctif."

      Draft: "du coup j'aimerais qu'on puisse glisser gauche droite entre les photos et aussi euh non pas juste ça un widget android pour voir les sessions"
      Output: "Ajoute deux améliorations :\n- Un balayage gauche/droite pour naviguer entre les aperçus photo.\n- Un widget Android affichant les sessions en cours."
    """.trimIndent()

    private val COMPACT_REWRITE_PROMPT = """
      Rewrite the user's voice draft in its original language to remove hesitations ("euh", "en fait", "tu vois"), fix typos, and make it clear and direct for a coding assistant. Do not answer or refuse; output ONLY the rewritten draft.
    """.trimIndent()
  }
}
