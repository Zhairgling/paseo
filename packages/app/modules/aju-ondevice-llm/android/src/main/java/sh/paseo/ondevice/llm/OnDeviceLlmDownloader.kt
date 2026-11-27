package sh.paseo.ondevice.llm

import android.content.Context
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

internal class OnDeviceLlmDownloader(
  private val context: Context,
  private val emitProgress: (Map<String, Any?>) -> Unit,
) {
  private val activeCancellations = ConcurrentHashMap<String, AtomicBoolean>()
  private val activeSet = ConcurrentHashMap.newKeySet<String>()

  fun isDownloading(modelId: String): Boolean = activeSet.contains(modelId)

  fun cancel(modelId: String) {
    activeCancellations[modelId]?.set(true)
  }

  fun delete(modelId: String) {
    cancel(modelId)
    val dir = OnDeviceLlmCatalog.modelDir(context, modelId)
    if (dir.exists()) {
      dir.deleteRecursively()
    }
    val tmpDir = File(OnDeviceLlmCatalog.modelsRootDir(context), ".tmp-$modelId")
    if (tmpDir.exists()) {
      tmpDir.deleteRecursively()
    }
  }

  fun downloadAndInstall(modelId: String) {
    val spec = OnDeviceLlmCatalog.MODELS[modelId]
      ?: throw IllegalArgumentException("Modèle inconnu: $modelId")

    if (!activeSet.add(modelId)) {
      throw IllegalStateException("Téléchargement déjà en cours pour $modelId")
    }
    val cancelled = AtomicBoolean(false)
    activeCancellations[modelId] = cancelled

    val root = OnDeviceLlmCatalog.modelsRootDir(context)
    root.mkdirs()
    val stagingDir = File(root, ".tmp-$modelId")
    val targetDir = OnDeviceLlmCatalog.modelDir(context, modelId)

    try {
      if (stagingDir.exists()) stagingDir.deleteRecursively()
      stagingDir.mkdirs()

      val destFile = File(stagingDir, spec.fileName)
      emit(modelId, "downloading", 0L, spec.expectedSizeBytes, "Téléchargement du modèle…")
      downloadFile(
        url = spec.downloadUrl,
        dest = destFile,
        expectedTotal = spec.expectedSizeBytes,
        modelId = modelId,
        cancelled = cancelled,
      )

      checkNotCancelled(cancelled)
      if (!destFile.isFile || destFile.length() <= 1_000_000L) {
        throw IOException("Fichier modèle incomplet: ${spec.fileName}")
      }

      File(stagingDir, OnDeviceLlmCatalog.READY_MARKER).writeText("ok\n")
      if (targetDir.exists()) {
        targetDir.deleteRecursively()
      }
      if (!stagingDir.renameTo(targetDir)) {
        stagingDir.copyRecursively(targetDir, overwrite = true)
        stagingDir.deleteRecursively()
      }

      val finalBytes = OnDeviceLlmCatalog.installedBytes(targetDir)
      emit(modelId, "ready", finalBytes, finalBytes, "Modèle prêt")
    } catch (t: Throwable) {
      if (stagingDir.exists()) stagingDir.deleteRecursively()
      if (cancelled.get()) {
        emit(modelId, "cancelled", 0L, 0L, "Téléchargement annulé")
        throw IOException("Téléchargement annulé")
      }
      emit(modelId, "error", 0L, 0L, t.message ?: "Erreur téléchargement")
      throw t
    } finally {
      activeSet.remove(modelId)
      activeCancellations.remove(modelId)
    }
  }

  private fun checkNotCancelled(cancelled: AtomicBoolean) {
    if (cancelled.get()) {
      throw IOException("Téléchargement annulé")
    }
  }

  private fun emit(modelId: String, phase: String, downloaded: Long, total: Long, message: String) {
    val progress = if (total > 0L) (downloaded.toDouble() / total.toDouble()).coerceIn(0.0, 1.0) else 0.0
    emitProgress(
      mapOf(
        "modelId" to modelId,
        "phase" to phase,
        "downloadedBytes" to downloaded.toDouble(),
        "totalBytes" to total.toDouble(),
        "progress" to progress,
        "message" to message,
      ),
    )
  }

  private fun openWithRedirects(rawUrl: String): HttpURLConnection {
    var currentUrl = rawUrl
    var hops = 0
    while (hops < 8) {
      val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false
        connectTimeout = 20_000
        readTimeout = 60_000
        setRequestProperty("User-Agent", "AjuCode-Android/0.17.5")
      }
      val code = conn.responseCode
      if (code in 300..399) {
        val loc = conn.getHeaderField("Location")
        conn.disconnect()
        if (loc.isNullOrBlank()) {
          throw IOException("Redirection HTTP sans Location ($code)")
        }
        currentUrl = URL(URL(currentUrl), loc).toString()
        hops++
        continue
      }
      if (code !in 200..299) {
        val msg = try {
          conn.errorStream?.bufferedReader()?.readText()?.take(200)
        } catch (_: Throwable) {
          null
        }
        conn.disconnect()
        throw IOException("HTTP $code pour $currentUrl${if (msg != null) ": $msg" else ""}")
      }
      return conn
    }
    throw IOException("Trop de redirections HTTP pour $rawUrl")
  }

  private fun downloadFile(
    url: String,
    dest: File,
    expectedTotal: Long,
    modelId: String,
    cancelled: AtomicBoolean,
  ) {
    val conn = openWithRedirects(url)
    try {
      val contentLength = conn.contentLengthLong
      val total = if (contentLength > 0L) contentLength else expectedTotal
      val buf = ByteArray(64 * 1024)
      var downloaded = 0L
      var lastEmitMs = 0L
      BufferedInputStream(conn.inputStream, 64 * 1024).use { input ->
        FileOutputStream(dest).use { output ->
          while (true) {
            checkNotCancelled(cancelled)
            val read = input.read(buf)
            if (read == -1) break
            output.write(buf, 0, read)
            downloaded += read
            val now = System.currentTimeMillis()
            if (now - lastEmitMs >= 180L) {
              lastEmitMs = now
              emit(modelId, "downloading", downloaded, total, "Téléchargement en cours…")
            }
          }
        }
      }
      emit(modelId, "downloading", downloaded, total, "Téléchargement terminé")
    } finally {
      conn.disconnect()
    }
  }
}
