package sh.paseo.ondevice.llm

import android.content.Context
import java.io.File

internal data class OnDeviceLlmSpec(
  val id: String,
  val label: String,
  val fileName: String,
  val downloadUrl: String,
  val expectedSizeBytes: Long,
)

internal object OnDeviceLlmCatalog {
  const val MODEL_QWEN3_0_6B_INT4 = "qwen3-0.6b-int4"
  const val MODEL_QWEN3_1_7B_INT4 = "qwen3-1.7b-int4"
  const val READY_MARKER = ".ready"

  val MODELS: Map<String, OnDeviceLlmSpec> = listOf(
    OnDeviceLlmSpec(
      id = MODEL_QWEN3_0_6B_INT4,
      label = "Qwen3 0.6B INT4 · Ultra-rapide (328 Mo)",
      fileName = "Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm",
      downloadUrl =
        "https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm",
      expectedSizeBytes = 343_500_000L,
    ),
    OnDeviceLlmSpec(
      id = MODEL_QWEN3_1_7B_INT4,
      label = "Qwen3 1.7B INT4 · Plus précis (932 Mo)",
      fileName = "Qwen3-1.7B_dynamic_wi4b32_afp32.litertlm",
      downloadUrl =
        "https://huggingface.co/litert-community/Qwen3-1.7B/resolve/main/Qwen3-1.7B_dynamic_wi4b32_afp32.litertlm",
      expectedSizeBytes = 977_200_000L,
    ),
  ).associateBy { it.id }

  fun modelsRootDir(context: Context): File =
    File(context.filesDir, "ajucode-reprompt-models")

  fun modelDir(context: Context, modelId: String): File =
    File(modelsRootDir(context), modelId)

  fun modelFile(context: Context, modelId: String): File? {
    val spec = MODELS[modelId] ?: return null
    return File(modelDir(context, modelId), spec.fileName)
  }

  fun isModelReady(context: Context, modelId: String): Boolean {
    val file = modelFile(context, modelId) ?: return false
    val dir = modelDir(context, modelId)
    return File(dir, READY_MARKER).isFile && file.isFile && file.length() > 1_000_000L
  }

  fun installedBytes(dir: File): Long {
    if (!dir.exists()) return 0L
    return dir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
  }
}
