package sh.paseo.ondevice.llm

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

class AjuOnDeviceLlmModule : Module() {
  private val downloadExecutor = Executors.newCachedThreadPool()
  private val inferenceExecutor = Executors.newSingleThreadExecutor()

  private var downloader: OnDeviceLlmDownloader? = null
  private var engine: OnDeviceLlmEngine? = null

  private fun requireCtx(): Context =
    appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("Contexte Android indisponible")

  private fun getDownloader(): OnDeviceLlmDownloader {
    downloader?.let { return it }
    return OnDeviceLlmDownloader(requireCtx()) { payload ->
      try {
        sendEvent("onDownloadProgress", payload)
      } catch (_: Throwable) {}
    }.also { downloader = it }
  }

  private fun getEngine(): OnDeviceLlmEngine {
    engine?.let { return it }
    return OnDeviceLlmEngine(requireCtx()).also { engine = it }
  }

  override fun definition() = ModuleDefinition {
    Name("AjuOnDeviceLlm")

    Events("onDownloadProgress")

    Function("getCapabilities") {
      val ctx = requireCtx()
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val memInfo = ActivityManager.MemoryInfo()
      am?.getMemoryInfo(memInfo)
      val totalRamMb = (memInfo.totalMem / (1024L * 1024L)).toInt()
      val abis = Build.SUPPORTED_ABIS.toList()
      mapOf(
        "supported" to (abis.contains("arm64-v8a") || abis.contains("x86_64")),
        "abis" to abis,
        "totalRamMb" to totalRamMb,
      )
    }

    Function("getModelStatuses") {
      val ctx = requireCtx()
      val dl = getDownloader()
      val out = HashMap<String, Map<String, Any?>>()
      for ((id, spec) in OnDeviceLlmCatalog.MODELS) {
        val dir = OnDeviceLlmCatalog.modelDir(ctx, id)
        val ready = OnDeviceLlmCatalog.isModelReady(ctx, id)
        val status = when {
          dl.isDownloading(id) -> "downloading"
          ready -> "ready"
          else -> "not_installed"
        }
        out[id] = mapOf(
          "id" to id,
          "label" to spec.label,
          "status" to status,
          "ready" to ready,
          "expectedSizeBytes" to spec.expectedSizeBytes.toDouble(),
          "installedBytes" to OnDeviceLlmCatalog.installedBytes(dir).toDouble(),
          "modelDir" to dir.absolutePath,
        )
      }
      out
    }

    AsyncFunction("downloadModel") { modelId: String, promise: Promise ->
      downloadExecutor.submit {
        try {
          getDownloader().downloadAndInstall(modelId)
          promise.resolve(true)
        } catch (t: Throwable) {
          promise.reject("DOWNLOAD_FAILED", t.message ?: "Erreur téléchargement", t)
        }
      }
    }

    Function("cancelDownload") { modelId: String ->
      getDownloader().cancel(modelId)
    }

    AsyncFunction("deleteModel") { modelId: String, promise: Promise ->
      downloadExecutor.submit {
        try {
          getEngine().release(modelId)
          getDownloader().delete(modelId)
          promise.resolve(true)
        } catch (t: Throwable) {
          promise.reject("DELETE_FAILED", t.message ?: "Erreur suppression", t)
        }
      }
    }

    AsyncFunction("preloadModel") { modelId: String, promise: Promise ->
      inferenceExecutor.submit {
        try {
          getEngine().preload(modelId)
          promise.resolve(true)
        } catch (t: Throwable) {
          promise.reject("PRELOAD_FAILED", t.message ?: "Erreur chargement modèle", t)
        }
      }
    }

    AsyncFunction("reprompt") { modelId: String, mode: String, text: String, promise: Promise ->
      inferenceExecutor.submit {
        try {
          val rewritten = getEngine().reprompt(modelId, mode, text)
          promise.resolve(rewritten)
        } catch (t: Throwable) {
          promise.reject("REPROMPT_FAILED", t.message ?: "Erreur reprompt", t)
        }
      }
    }

    OnDestroy {
      engine?.release(null)
    }
  }
}
