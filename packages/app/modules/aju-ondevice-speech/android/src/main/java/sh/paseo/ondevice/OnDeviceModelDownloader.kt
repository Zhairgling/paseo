package sh.paseo.ondevice

import android.content.Context
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

internal class OnDeviceModelDownloader(
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
    val dir = OnDeviceSpeechCatalog.modelDir(context, modelId)
    if (dir.exists()) {
      dir.deleteRecursively()
    }
    val tmpDir = File(OnDeviceSpeechCatalog.modelsRootDir(context), ".tmp-$modelId")
    if (tmpDir.exists()) {
      tmpDir.deleteRecursively()
    }
    val tmpArchive = File(OnDeviceSpeechCatalog.modelsRootDir(context), ".dl-$modelId.tar.bz2.part")
    if (tmpArchive.exists()) {
      tmpArchive.delete()
    }
  }

  fun downloadAndInstall(modelId: String) {
    val spec = OnDeviceSpeechCatalog.MODELS[modelId]
      ?: throw IllegalArgumentException("Modèle inconnu: $modelId")

    if (!activeSet.add(modelId)) {
      throw IllegalStateException("Téléchargement déjà en cours pour $modelId")
    }
    val cancelled = AtomicBoolean(false)
    activeCancellations[modelId] = cancelled

    val root = OnDeviceSpeechCatalog.modelsRootDir(context)
    root.mkdirs()
    val tmpArchive = File(root, ".dl-$modelId.tar.bz2.part")
    val stagingDir = File(root, ".tmp-$modelId")
    val targetDir = OnDeviceSpeechCatalog.modelDir(context, modelId)

    try {
      if (stagingDir.exists()) stagingDir.deleteRecursively()
      stagingDir.mkdirs()

      emit(modelId, "downloading", 0L, spec.expectedSizeBytes, "Téléchargement du modèle…")
      downloadFile(
        url = spec.archiveUrl,
        dest = tmpArchive,
        expectedTotal = spec.expectedSizeBytes,
        modelId = modelId,
        cancelled = cancelled,
      )

      checkNotCancelled(cancelled)
      emit(modelId, "extracting", spec.expectedSizeBytes, spec.expectedSizeBytes, "Décompression des poids ONNX…")
      extractTarBz2StrippingRoot(tmpArchive, stagingDir, cancelled)
      tmpArchive.delete()

      for ((relPath, extraUrl) in spec.extraFiles) {
        checkNotCancelled(cancelled)
        val outFile = File(stagingDir, relPath)
        outFile.parentFile?.mkdirs()
        emit(modelId, "downloading", spec.expectedSizeBytes, spec.expectedSizeBytes, "Téléchargement de $relPath…")
        downloadFile(
          url = extraUrl,
          dest = outFile,
          expectedTotal = 2_400_000L,
          modelId = modelId,
          cancelled = cancelled,
        )
      }

      checkNotCancelled(cancelled)
      for (rel in spec.requiredFiles) {
        val f = File(stagingDir, rel)
        if (!f.isFile || f.length() <= 0L) {
          throw IOException("Fichier manquant après extraction: $rel")
        }
      }

      File(stagingDir, OnDeviceSpeechCatalog.READY_MARKER).writeText("ok\n")
      if (targetDir.exists()) {
        targetDir.deleteRecursively()
      }
      if (!stagingDir.renameTo(targetDir)) {
        stagingDir.copyRecursively(targetDir, overwrite = true)
        stagingDir.deleteRecursively()
      }

      val finalBytes = OnDeviceSpeechCatalog.installedBytes(targetDir)
      emit(modelId, "ready", finalBytes, finalBytes, "Modèle prêt")
    } catch (t: Throwable) {
      if (tmpArchive.exists()) tmpArchive.delete()
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
        readTimeout = 45_000
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

  private fun extractTarBz2StrippingRoot(
    archive: File,
    destDir: File,
    cancelled: AtomicBoolean,
  ) {
    val canonicalDest = destDir.canonicalPath
    val buf = ByteArray(64 * 1024)
    FileInputStream(archive).use { fis ->
      BufferedInputStream(fis, 64 * 1024).use { bis ->
        BZip2CompressorInputStream(bis, true).use { bzis ->
          TarArchiveInputStream(bzis).use { tais ->
            while (true) {
              checkNotCancelled(cancelled)
              val entry = tais.nextEntry ?: break
              if (entry.isDirectory) continue
              val normalized = entry.name.trimStart('.', '/')
              val slashIdx = normalized.indexOf('/')
              val relPath = if (slashIdx >= 0) normalized.substring(slashIdx + 1) else normalized
              if (relPath.isBlank()) continue
              val outFile = File(destDir, relPath)
              if (!outFile.canonicalPath.startsWith(canonicalDest + File.separator)) {
                throw SecurityException("Chemin archive invalide: ${entry.name}")
              }
              outFile.parentFile?.mkdirs()
              FileOutputStream(outFile).use { fos ->
                while (true) {
                  checkNotCancelled(cancelled)
                  val n = tais.read(buf)
                  if (n == -1) break
                  fos.write(buf, 0, n)
                }
              }
            }
          }
        }
      }
    }
  }
}
