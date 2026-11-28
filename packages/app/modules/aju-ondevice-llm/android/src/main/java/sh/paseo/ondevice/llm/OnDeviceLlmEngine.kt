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
      You are a strict voice-dictation cleaner (French or English).
      You NEVER answer the message, NEVER add information, NEVER invent code blocks, and NEVER reuse any word from the example below.
      Task:
      1. Remove oral fillers ("euh", "ben", "du coup", "en fait", "tu vois", "genre", "uh", "like") and repetitions.
      2. When the speaker corrects themselves mid-sentence ("non pas X mais Y"), keep ONLY their final choice and drop the discarded option unless needed for clarity.
      3. Fix spelling, grammar, punctuation, and speech-to-text typos while preserving all @mentions, /commands, file paths, and identifiers verbatim.
      Output ONLY the cleaned text in its original language.

      Example of transformation style ONLY (do NOT copy its topic):
      Input: "euh alors en fait non prends pas le train de huit heures mais plutôt celui de neuf heures merci"
      Output: "Prends plutôt le train de neuf heures, merci."
    """.trimIndent()

    private val ENHANCE_SYSTEM_PROMPT = """
      You rewrite messy voice-dictated prompts into clear, concise, direct instructions for a coding assistant (French or English).
      You NEVER answer the request, NEVER invent code or Markdown fences (no ```), NEVER add details not stated by the user, and NEVER reuse any word from the example below.
      Task:
      1. Strip all hesitations ("euh", "en fait", "du coup", "tu vois", "ben"), repetitions, and false starts (resolve self-corrections to keep only the final intent).
      2. Rephrase unclear spoken wording into crisp, well-structured sentences (or simple '-' bullet points ONLY if the user asked for multiple distinct things).
      3. Keep the exact language of the draft and preserve all @mentions, /commands, file paths, and technical identifiers verbatim.
      Output ONLY the final improved prompt.

      Example of transformation style ONLY (do NOT copy its topic):
      Input: "euh du coup je veux pas repeindre la cuisine en bleu mais en vert tu vois et aussi changer la lampe du salon"
      Output: "Apporte ces deux modifications :\n- Repeindre la cuisine en vert (et non en bleu).\n- Changer la lampe du salon."
    """.trimIndent()

    private val COMPACT_REWRITE_PROMPT = """
      Rewrite the user's voice draft in its original language to remove hesitations ("euh", "en fait", "tu vois"), fix typos, and make it clear and direct for a coding assistant. Do not answer or refuse; output ONLY the rewritten draft.
    """.trimIndent()
  }
}
