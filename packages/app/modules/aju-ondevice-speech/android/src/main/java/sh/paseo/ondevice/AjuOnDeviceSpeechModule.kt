package sh.paseo.ondevice

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

class AjuOnDeviceSpeechModule : Module() {
  private val downloadExecutor = Executors.newCachedThreadPool()
  private val speechExecutor = Executors.newCachedThreadPool()

  private var downloader: OnDeviceModelDownloader? = null
  private var engine: OnDeviceSpeechEngine? = null

  private fun requireCtx(): Context =
    appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("Contexte Android indisponible")

  private fun getDownloader(): OnDeviceModelDownloader {
    downloader?.let { return it }
    return OnDeviceModelDownloader(requireCtx()) { payload ->
      try {
        sendEvent("onDownloadProgress", payload)
      } catch (_: Throwable) {}
    }.also { downloader = it }
  }

  private fun getEngine(): OnDeviceSpeechEngine {
    engine?.let { return it }
    return OnDeviceSpeechEngine(
      context = requireCtx(),
      emitAsrPartial = { partial ->
        try {
          sendEvent("onAsrPartial", mapOf("text" to partial))
        } catch (_: Throwable) {}
      },
      emitTtsState = { state ->
        try {
          sendEvent("onTtsState", mapOf("state" to state))
        } catch (_: Throwable) {}
      },
    ).also { engine = it }
  }

  override fun definition() = ModuleDefinition {
    Name("AjuOnDeviceSpeech")

    Events("onDownloadProgress", "onAsrPartial", "onTtsState")

    Function("getCapabilities") {
      val ctx = requireCtx()
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val memInfo = ActivityManager.MemoryInfo()
      am?.getMemoryInfo(memInfo)
      val totalRamMb = (memInfo.totalMem / (1024L * 1024L)).toInt()
      val abis = Build.SUPPORTED_ABIS.toList()
      mapOf(
        "supported" to abis.contains("arm64-v8a"),
        "abis" to abis,
        "totalRamMb" to totalRamMb,
        "builtinVoices" to OnDeviceSpeechCatalog.BUILTIN_POCKET_VOICES.sorted(),
      )
    }

    Function("getModelStatuses") {
      val ctx = requireCtx()
      val dl = getDownloader()
      val out = HashMap<String, Map<String, Any?>>()
      for ((id, spec) in OnDeviceSpeechCatalog.MODELS) {
        val dir = OnDeviceSpeechCatalog.modelDir(ctx, id)
        val ready = OnDeviceSpeechCatalog.isModelReady(ctx, id)
        val status = when {
          dl.isDownloading(id) -> "downloading"
          ready -> "ready"
          else -> "not_installed"
        }
        out[id] = mapOf(
          "id" to id,
          "kind" to spec.kind,
          "label" to spec.label,
          "status" to status,
          "ready" to ready,
          "expectedSizeBytes" to spec.expectedSizeBytes.toDouble(),
          "installedBytes" to OnDeviceSpeechCatalog.installedBytes(dir).toDouble(),
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
          getEngine().releaseModel(modelId)
          getDownloader().delete(modelId)
          promise.resolve(true)
        } catch (t: Throwable) {
          promise.reject("DELETE_FAILED", t.message ?: "Erreur suppression", t)
        }
      }
    }

    AsyncFunction("preloadModel") { modelId: String, promise: Promise ->
      speechExecutor.submit {
        try {
          getEngine().preloadModel(modelId)
          promise.resolve(true)
        } catch (t: Throwable) {
          promise.reject("PRELOAD_FAILED", t.message ?: "Erreur chargement modèle", t)
        }
      }
    }

    AsyncFunction("startAsr") { promise: Promise ->
      speechExecutor.submit {
        try {
          getEngine().startAsrSession()
          promise.resolve(true)
        } catch (t: Throwable) {
          promise.reject("ASR_START_FAILED", t.message ?: "Erreur démarrage ASR", t)
        }
      }
    }

    Function("feedAsrPcm") { base64Pcm: String ->
      engine?.feedAsrPcm(base64Pcm)
    }

    AsyncFunction("finishAsr") { promise: Promise ->
      speechExecutor.submit {
        try {
          val transcript = getEngine().finishAsrSession()
          promise.resolve(transcript)
        } catch (t: Throwable) {
          promise.reject("ASR_FINISH_FAILED", t.message ?: "Erreur transcription ASR", t)
        }
      }
    }

    Function("cancelAsr") {
      engine?.cancelAsrSession()
    }

    AsyncFunction("speak") { text: String, options: Map<String, Any?>, promise: Promise ->
      speechExecutor.submit {
        try {
          val engineName = (options["engine"] as? String) ?: "pocket-fr"
          val voice = (options["voice"] as? String) ?: "iris"
          val speed = (options["speed"] as? Number)?.toFloat() ?: 1.0f
          val lang = (options["lang"] as? String) ?: "fr"
          getEngine().speak(text, engineName, voice, speed, lang)
          promise.resolve(true)
        } catch (t: Throwable) {
          promise.reject("TTS_SPEAK_FAILED", t.message ?: "Erreur synthèse vocale", t)
        }
      }
    }

    Function("stopSpeaking") {
      engine?.stopSpeaking()
    }

    AsyncFunction("synthesizeToWav") { text: String, options: Map<String, Any?>, outPath: String, promise: Promise ->
      speechExecutor.submit {
        try {
          val engineName = (options["engine"] as? String) ?: "pocket-fr"
          val voice = (options["voice"] as? String) ?: "iris"
          val speed = (options["speed"] as? Number)?.toFloat() ?: 1.0f
          val lang = (options["lang"] as? String) ?: "fr"
          val samples = getEngine().synthesizeToWav(text, engineName, voice, speed, lang, outPath)
          promise.resolve(samples)
        } catch (t: Throwable) {
          promise.reject("TTS_SYNTH_FAILED", t.message ?: "Erreur écriture WAV", t)
        }
      }
    }

    OnDestroy {
      engine?.releaseAll()
      engine = null
      downloadExecutor.shutdownNow()
      speechExecutor.shutdownNow()
    }
  }
}
