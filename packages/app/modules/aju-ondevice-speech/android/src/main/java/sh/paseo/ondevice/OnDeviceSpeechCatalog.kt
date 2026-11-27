package sh.paseo.ondevice

import android.content.Context
import java.io.File

internal data class OnDeviceModelSpec(
  val id: String,
  val kind: String, // "asr" | "tts"
  val label: String,
  val archiveUrl: String,
  val expectedSizeBytes: Long,
  val requiredFiles: List<String>,
  val extraFiles: Map<String, String> = emptyMap(),
)

internal object OnDeviceSpeechCatalog {
  const val MODEL_ASR_PARAKEET_V3 = "asr-parakeet-v3"
  const val MODEL_TTS_POCKET_FR = "tts-pocket-fr"
  const val MODEL_TTS_SUPERTONIC_3 = "tts-supertonic-3"
  const val READY_MARKER = ".ready"

  val BUILTIN_POCKET_VOICES = setOf("iris", "julien", "vald")
  val ARCHIVE_POCKET_VOICES = setOf("estelle", "fabien")

  val SUPERTONIC_VOICES: Map<String, Int> = mapOf(
    "F1" to 0,
    "F2" to 1,
    "F3" to 2,
    "F4" to 3,
    "F5" to 4,
    "M1" to 5,
    "M2" to 6,
    "M3" to 7,
    "M4" to 8,
    "M5" to 9,
  )

  val MODELS: Map<String, OnDeviceModelSpec> = listOf(
    OnDeviceModelSpec(
      id = MODEL_ASR_PARAKEET_V3,
      kind = "asr",
      label = "Parakeet TDT 0.6B v3 (FR/EN)",
      archiveUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
      expectedSizeBytes = 489_524_544L,
      requiredFiles = listOf(
        "encoder.int8.onnx",
        "decoder.int8.onnx",
        "joiner.int8.onnx",
        "tokens.txt",
        "silero_vad_v5.onnx",
      ),
      extraFiles = mapOf(
        "silero_vad_v5.onnx" to "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx",
      ),
    ),
    OnDeviceModelSpec(
      id = MODEL_TTS_POCKET_FR,
      kind = "tts",
      label = "Kyutai Pocket TTS FR INT8 (Iris · Julien · Vald)",
      archiveUrl = "https://huggingface.co/Duf-1/pocket-tts-sherpa-onnx/resolve/main/pocket-french-int8.tar.bz2",
      expectedSizeBytes = 85_977_560L,
      requiredFiles = listOf(
        "lm_flow.int8.onnx",
        "lm_main.int8.onnx",
        "encoder.onnx",
        "decoder.onnx",
        "text_conditioner.onnx",
        "vocab.json",
        "token_scores.json",
      ),
    ),
    OnDeviceModelSpec(
      id = MODEL_TTS_SUPERTONIC_3,
      kind = "tts",
      label = "Supertone Supertonic 3 INT8 (31 langues)",
      archiveUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2",
      expectedSizeBytes = 128_774_318L,
      requiredFiles = listOf(
        "duration_predictor.int8.onnx",
        "text_encoder.int8.onnx",
        "vector_estimator.int8.onnx",
        "vocoder.int8.onnx",
        "tts.json",
        "unicode_indexer.bin",
        "voice.bin",
      ),
    ),
  ).associateBy { it.id }

  fun modelsRootDir(context: Context): File =
    File(context.filesDir, "ajucode-speech-models")

  fun modelDir(context: Context, modelId: String): File =
    File(modelsRootDir(context), modelId)

  fun isModelReady(context: Context, modelId: String): Boolean {
    val spec = MODELS[modelId] ?: return false
    val dir = modelDir(context, modelId)
    if (!File(dir, READY_MARKER).isFile) return false
    return spec.requiredFiles.all { rel ->
      val f = File(dir, rel)
      f.isFile && f.length() > 0L
    }
  }

  fun installedBytes(dir: File): Long {
    if (!dir.exists()) return 0L
    return dir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
  }

  fun normalizeTextForPocketFr(raw: String): String {
    var s = raw
      .replace("\u2019", "'")
      .replace("\u2018", "'")
      .replace("\u201c", "")
      .replace("\u201d", "")
      .replace("\u201e", "")
      .replace("«", "")
      .replace("»", "")
      .replace("\"", "")
      .replace("(", "")
      .replace(")", "")
      .replace("[", "")
      .replace("]", "")
      .replace(";", ",")
      .replace(":", ",")
      .replace("\u2013", ",")
      .replace("\u2014", ",")
      .replace(Regex("\\s+"), " ")
      .trim()
    if (s.isEmpty()) return ""
    val first = s[0]
    if (first.isLowerCase()) {
      s = first.uppercaseChar() + s.substring(1)
    }
    val last = s.last()
    if (last !in charArrayOf('.', '!', '?')) {
      s += "."
    }
    return s
  }

  fun splitIntoSpeechChunks(raw: String, maxChars: Int = 200, firstChunkMaxChars: Int = 85): List<String> {
    val clean = raw
      .replace("\r\n", "\n")
      .replace(Regex("[\\u200B-\\u200D\\uFEFF]"), "")
      .trim()
    if (clean.isEmpty()) return emptyList()

    val paragraphs = clean.split(Regex("\n+"))
    val rawSentences = ArrayList<String>()
    val sentenceSplit = Regex("(?<=[.!?…])\\s+")
    for (p in paragraphs) {
      val trimmed = p.trim()
      if (trimmed.isEmpty()) continue
      for (part in trimmed.split(sentenceSplit)) {
        val item = part.trim()
        if (item.isNotEmpty()) rawSentences.add(item)
      }
    }

    val chunks = ArrayList<String>()
    val current = StringBuilder()
    for (sentence in rawSentences) {
      // Keep the very first chunk short so TTS begins speaking immediately without buffering a paragraph.
      val limit = if (chunks.isEmpty()) firstChunkMaxChars else maxChars
      if (sentence.length > limit) {
        if (current.isNotEmpty()) {
          chunks.add(current.toString().trim())
          current.setLength(0)
        }
        // Further split long sentence on commas or spaces
        val subParts = sentence.split(Regex("(?<=,)\\s+"))
        val subBuf = StringBuilder()
        for (sp in subParts) {
          val subLimit = if (chunks.isEmpty()) firstChunkMaxChars else maxChars
          if (subBuf.isNotEmpty() && subBuf.length + 1 + sp.length > subLimit) {
            chunks.add(subBuf.toString().trim())
            subBuf.setLength(0)
          }
          if (subBuf.isNotEmpty()) subBuf.append(' ')
          subBuf.append(sp)
        }
        if (subBuf.isNotEmpty()) chunks.add(subBuf.toString().trim())
      } else if (current.isNotEmpty() && current.length + 1 + sentence.length > limit) {
        chunks.add(current.toString().trim())
        current.setLength(0)
        current.append(sentence)
      } else {
        if (current.isNotEmpty()) current.append(' ')
        current.append(sentence)
      }
    }
    if (current.isNotEmpty()) {
      chunks.add(current.toString().trim())
    }
    return chunks
  }
}
