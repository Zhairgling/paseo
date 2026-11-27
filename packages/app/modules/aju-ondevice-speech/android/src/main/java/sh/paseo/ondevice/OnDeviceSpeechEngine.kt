package sh.paseo.ondevice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Base64
import android.util.Log
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.GenerationConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsPocketModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsSupertonicModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import com.k2fsa.sherpa.onnx.WaveData
import com.k2fsa.sherpa.onnx.WaveReader
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt

internal class OnDeviceSpeechEngine(
  private val context: Context,
  private val emitAsrPartial: (String) -> Unit,
  private val emitTtsState: (String) -> Unit,
) {
  private val asrLock = Any()
  private val ttsLock = Any()

  @Volatile private var asrRecognizer: OfflineRecognizer? = null
  @Volatile private var asrVad: Vad? = null
  @Volatile private var pocketTts: OfflineTts? = null
  @Volatile private var supertonicTts: OfflineTts? = null

  private val voiceWaveCache = ConcurrentHashMap<String, WaveData>()

  // Sequential ASR chunk decoder so VAD segments are decoded in chronological order
  private val asrExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private var vadRemainder = FloatArray(0)
  private val fallbackRawSamples = ArrayList<Float>(16_000 * 30)
  private val decodedSegments = ArrayList<String>()
  private val pendingFutures = ArrayList<Future<*>>()
  @Volatile private var asrActive = false

  // Streaming AudioTrack + cancellation token for TTS
  private val ttsGenerationId = AtomicLong(0L)
  @Volatile private var activeAudioTrack: AudioTrack? = null

  fun preloadModel(modelId: String) {
    when (modelId) {
      OnDeviceSpeechCatalog.MODEL_ASR_PARAKEET_V3 -> synchronized(asrLock) { ensureAsrLoaded() }
      OnDeviceSpeechCatalog.MODEL_TTS_POCKET_FR -> synchronized(ttsLock) { ensurePocketLoaded() }
      OnDeviceSpeechCatalog.MODEL_TTS_SUPERTONIC_3 -> synchronized(ttsLock) { ensureSupertonicLoaded() }
      else -> throw IllegalArgumentException("Modèle inconnu: $modelId")
    }
  }

  fun releaseModel(modelId: String) {
    when (modelId) {
      OnDeviceSpeechCatalog.MODEL_ASR_PARAKEET_V3 -> synchronized(asrLock) {
        asrActive = false
        asrVad?.release()
        asrVad = null
        asrRecognizer?.release()
        asrRecognizer = null
      }
      OnDeviceSpeechCatalog.MODEL_TTS_POCKET_FR -> synchronized(ttsLock) {
        pocketTts?.release()
        pocketTts = null
        voiceWaveCache.clear()
      }
      OnDeviceSpeechCatalog.MODEL_TTS_SUPERTONIC_3 -> synchronized(ttsLock) {
        supertonicTts?.release()
        supertonicTts = null
      }
    }
  }

  fun releaseAll() {
    stopSpeaking()
    releaseModel(OnDeviceSpeechCatalog.MODEL_ASR_PARAKEET_V3)
    releaseModel(OnDeviceSpeechCatalog.MODEL_TTS_POCKET_FR)
    releaseModel(OnDeviceSpeechCatalog.MODEL_TTS_SUPERTONIC_3)
    asrExecutor.shutdownNow()
  }

  // -------------------------------------------------------------------------
  // ASR (Parakeet-TDT-0.6B-v3 + Silero VAD v5)
  // -------------------------------------------------------------------------

  private fun ensureAsrLoaded() {
    if (!OnDeviceSpeechCatalog.isModelReady(context, OnDeviceSpeechCatalog.MODEL_ASR_PARAKEET_V3)) {
      throw IllegalStateException("Modèle ASR Parakeet v3 non installé")
    }
    val dir = OnDeviceSpeechCatalog.modelDir(context, OnDeviceSpeechCatalog.MODEL_ASR_PARAKEET_V3).absolutePath
    if (asrRecognizer == null) {
      val config = OfflineRecognizerConfig(
        featConfig = FeatureConfig(sampleRate = 16_000, featureDim = 80),
        modelConfig = OfflineModelConfig(
          transducer = OfflineTransducerModelConfig(
            encoder = "$dir/encoder.int8.onnx",
            decoder = "$dir/decoder.int8.onnx",
            joiner = "$dir/joiner.int8.onnx",
          ),
          tokens = "$dir/tokens.txt",
          modelType = "nemo_transducer",
          numThreads = 4,
          provider = "cpu",
          debug = false,
        ),
        decodingMethod = "greedy_search",
      )
      asrRecognizer = OfflineRecognizer(config = config)
    }
    if (asrVad == null) {
      val vadConfig = VadModelConfig(
        sileroVadModelConfig = SileroVadModelConfig(
          model = "$dir/silero_vad_v5.onnx",
          threshold = 0.45f,
          minSilenceDuration = 0.45f,
          minSpeechDuration = 0.20f,
          windowSize = 512,
          maxSpeechDuration = 28.0f,
        ),
        sampleRate = 16_000,
        numThreads = 1,
        provider = "cpu",
        debug = false,
      )
      asrVad = Vad(config = vadConfig)
    }
  }

  fun startAsrSession() {
    synchronized(asrLock) {
      ensureAsrLoaded()
      asrVad?.reset()
      vadRemainder = FloatArray(0)
      fallbackRawSamples.clear()
      decodedSegments.clear()
      pendingFutures.clear()
      asrActive = true
    }
  }

  fun feedAsrPcm(base64Pcm: String) {
    if (!asrActive) return
    val bytes = Base64.decode(base64Pcm, Base64.DEFAULT)
    if (bytes.size < 2) return

    val sampleCount = bytes.size / 2
    val incoming = FloatArray(sampleCount)
    val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until sampleCount) {
      incoming[i] = bb.getShort().toFloat() / 32768.0f
    }

    synchronized(asrLock) {
      if (!asrActive) return
      val vad = asrVad ?: return
      // Keep up to 90s as fallback in case the speaker pauses < minSpeechDuration
      if (fallbackRawSamples.size + incoming.size <= 16_000 * 90) {
        for (s in incoming) fallbackRawSamples.add(s)
      }

      val combined = FloatArray(vadRemainder.size + incoming.size)
      System.arraycopy(vadRemainder, 0, combined, 0, vadRemainder.size)
      System.arraycopy(incoming, 0, combined, vadRemainder.size, incoming.size)

      val winSize = 512
      var offset = 0
      while (offset + winSize <= combined.size) {
        val window = combined.copyOfRange(offset, offset + winSize)
        vad.acceptWaveform(window)
        offset += winSize
      }
      vadRemainder = if (offset < combined.size) {
        combined.copyOfRange(offset, combined.size)
      } else {
        FloatArray(0)
      }

      drainVadSegmentsLocked(vad)
    }
  }

  private fun drainVadSegmentsLocked(vad: Vad) {
    while (!vad.empty()) {
      val segment = vad.front()
      vad.pop()
      val samples = segment.samples
      if (samples.isEmpty()) continue
      val future = asrExecutor.submit {
        val text = decodeFloatSamples(samples)
        if (text.isNotEmpty()) {
          val partial: String
          synchronized(decodedSegments) {
            decodedSegments.add(text)
            partial = decodedSegments.joinToString(" ").trim()
          }
          emitAsrPartial(partial)
        }
      }
      pendingFutures.add(future)
    }
  }

  fun finishAsrSession(): String {
    val futuresSnapshot: List<Future<*>>
    val rawSnapshot: FloatArray
    synchronized(asrLock) {
      if (!asrActive) return ""
      val vad = asrVad
      if (vad != null) {
        if (vadRemainder.isNotEmpty()) {
          val padded = FloatArray(512)
          System.arraycopy(vadRemainder, 0, padded, 0, minOf(vadRemainder.size, 512))
          vad.acceptWaveform(padded)
          vadRemainder = FloatArray(0)
        }
        vad.flush()
        drainVadSegmentsLocked(vad)
        vad.reset()
      }
      futuresSnapshot = ArrayList(pendingFutures)
      pendingFutures.clear()
      rawSnapshot = fallbackRawSamples.toFloatArray()
      fallbackRawSamples.clear()
      asrActive = false
    }

    for (f in futuresSnapshot) {
      try {
        f.get()
      } catch (_: Throwable) {
        // Ignore cancelled futures
      }
    }

    var finalText: String
    synchronized(decodedSegments) {
      finalText = decodedSegments.joinToString(" ").trim()
    }
    if (finalText.isEmpty() && rawSnapshot.size >= 1600) {
      finalText = decodeFloatSamples(rawSnapshot)
    }
    return finalText.replace(Regex("\\s+"), " ").trim()
  }

  fun cancelAsrSession() {
    synchronized(asrLock) {
      asrActive = false
      vadRemainder = FloatArray(0)
      fallbackRawSamples.clear()
      for (f in pendingFutures) f.cancel(true)
      pendingFutures.clear()
      synchronized(decodedSegments) {
        decodedSegments.clear()
      }
      asrVad?.reset()
    }
  }

  private fun decodeFloatSamples(samples: FloatArray): String {
    val recognizer = synchronized(asrLock) { asrRecognizer } ?: return ""
    val stream = recognizer.createStream()
    return try {
      stream.acceptWaveform(samples, sampleRate = 16_000)
      recognizer.decode(stream)
      recognizer.getResult(stream).text.trim()
    } finally {
      stream.release()
    }
  }

  // -------------------------------------------------------------------------
  // TTS (Kyutai Pocket TTS FR INT8 + Supertone Supertonic 3 INT8)
  // -------------------------------------------------------------------------

  private fun ensurePocketLoaded(): OfflineTts {
    pocketTts?.let { return it }
    if (!OnDeviceSpeechCatalog.isModelReady(context, OnDeviceSpeechCatalog.MODEL_TTS_POCKET_FR)) {
      throw IllegalStateException("Modèle Pocket TTS FR non installé")
    }
    val dir = OnDeviceSpeechCatalog.modelDir(context, OnDeviceSpeechCatalog.MODEL_TTS_POCKET_FR).absolutePath
    val config = OfflineTtsConfig(
      model = OfflineTtsModelConfig(
        pocket = OfflineTtsPocketModelConfig(
          lmFlow = "$dir/lm_flow.int8.onnx",
          lmMain = "$dir/lm_main.int8.onnx",
          encoder = "$dir/encoder.onnx",
          decoder = "$dir/decoder.onnx",
          textConditioner = "$dir/text_conditioner.onnx",
          vocabJson = "$dir/vocab.json",
          tokenScoresJson = "$dir/token_scores.json",
          voiceEmbeddingCacheCapacity = 50,
        ),
        numThreads = 4,
        debug = false,
        provider = "cpu",
      ),
    )
    return OfflineTts(config = config).also { pocketTts = it }
  }

  private fun ensureSupertonicLoaded(): OfflineTts {
    supertonicTts?.let { return it }
    if (!OnDeviceSpeechCatalog.isModelReady(context, OnDeviceSpeechCatalog.MODEL_TTS_SUPERTONIC_3)) {
      throw IllegalStateException("Modèle Supertonic 3 non installé")
    }
    val dir = OnDeviceSpeechCatalog.modelDir(context, OnDeviceSpeechCatalog.MODEL_TTS_SUPERTONIC_3).absolutePath
    val config = OfflineTtsConfig(
      model = OfflineTtsModelConfig(
        supertonic = OfflineTtsSupertonicModelConfig(
          durationPredictor = "$dir/duration_predictor.int8.onnx",
          textEncoder = "$dir/text_encoder.int8.onnx",
          vectorEstimator = "$dir/vector_estimator.int8.onnx",
          vocoder = "$dir/vocoder.int8.onnx",
          ttsJson = "$dir/tts.json",
          unicodeIndexer = "$dir/unicode_indexer.bin",
          voiceStyle = "$dir/voice.bin",
        ),
        numThreads = 4,
        debug = false,
        provider = "cpu",
      ),
    )
    return OfflineTts(config = config).also { supertonicTts = it }
  }

  private fun resolvePocketVoice(voiceId: String): WaveData {
    val clean = voiceId.lowercase().trim()
    val effective = if (
      clean in OnDeviceSpeechCatalog.BUILTIN_POCKET_VOICES ||
      clean in OnDeviceSpeechCatalog.ARCHIVE_POCKET_VOICES
    ) {
      clean
    } else {
      "iris"
    }
    voiceWaveCache[effective]?.let { return it }

    val wave = if (effective in OnDeviceSpeechCatalog.BUILTIN_POCKET_VOICES) {
      WaveReader.readWave(context.assets, "voices/$effective.wav")
    } else {
      val dir = OnDeviceSpeechCatalog.modelDir(context, OnDeviceSpeechCatalog.MODEL_TTS_POCKET_FR).absolutePath
      val file = File(dir, "voices/$effective.wav")
      if (!file.isFile) {
        WaveReader.readWave(context.assets, "voices/iris.wav")
      } else {
        WaveReader.readWave(file.absolutePath)
      }
    }
    voiceWaveCache[effective] = wave
    return wave
  }

  fun stopSpeaking() {
    ttsGenerationId.incrementAndGet()
    val track = activeAudioTrack
    activeAudioTrack = null
    if (track != null) {
      try {
        track.pause()
        track.flush()
        track.stop()
      } catch (_: Throwable) {
        // Ignore AudioTrack teardown races
      } finally {
        try {
          track.release()
        } catch (_: Throwable) {}
      }
    }
    emitTtsState("idle")
  }

  fun speak(
    rawText: String,
    engine: String,
    voice: String,
    speed: Float,
    lang: String,
  ) {
    val chunks = OnDeviceSpeechCatalog.splitIntoSpeechChunks(rawText)
    if (chunks.isEmpty()) return

    val myGen = ttsGenerationId.incrementAndGet()
    stopAudioTrackOnly()
      emitTtsState("speaking")

    var track: AudioTrack? = null
    var totalFramesWritten = 0L
    var sampleRate = 24_000
    try {
      synchronized(ttsLock) {
        if (myGen != ttsGenerationId.get()) return
        val usePocket = engine != "supertonic-3"
        val tts = if (usePocket) ensurePocketLoaded() else ensureSupertonicLoaded()
        sampleRate = tts.sampleRate()
        track = createStreamingTrack(sampleRate).also {
          activeAudioTrack = it
          it.play()
        }

        val clampedSpeed = speed.coerceIn(0.6f, 1.8f)
        val pocketWave = if (usePocket) resolvePocketVoice(voice) else null
        val superSid = OnDeviceSpeechCatalog.SUPERTONIC_VOICES[voice.uppercase()] ?: 0
        val effectiveLang = lang.ifBlank { "fr" }

        for (rawChunk in chunks) {
          if (myGen != ttsGenerationId.get()) break
          val text = if (usePocket) {
            OnDeviceSpeechCatalog.normalizeTextForPocketFr(rawChunk)
          } else {
            rawChunk
          }
          if (text.isEmpty()) continue

          val genConfig = if (usePocket && pocketWave != null) {
            GenerationConfig(
              speed = clampedSpeed,
              referenceAudio = pocketWave.samples,
              referenceSampleRate = pocketWave.sampleRate,
              numSteps = 5,
              extra = mapOf(
                "temperature" to "0.5",
                "chunk_size" to "15",
              ),
            )
          } else {
            GenerationConfig(
              sid = superSid,
              speed = clampedSpeed,
              numSteps = 6,
              extra = mapOf(
                "lang" to effectiveLang,
              ),
            )
          }

          val audio = tts.generateWithConfig(text = text, config = genConfig)
          val generatedSamples = audio.samples
          Log.w("AjuOnDevice", "tts engine=$engine voice=$voice chunkChars=${text.length} samples=${generatedSamples.size} sr=$sampleRate")
          if (generatedSamples.isEmpty()) {
            throw IllegalStateException("Audio vide généré ($engine / $voice)")
          }
          totalFramesWritten += writeFloatSamplesChunked(track, generatedSamples, myGen)
        }

        // Write a tiny 150ms silence pad so Bluetooth A2DP drains cleanly before releasing.
        if (myGen == ttsGenerationId.get() && totalFramesWritten > 0L) {
          val pad = ShortArray((sampleRate * 0.15f).toInt())
          writePcm16ToTrack(track, pad)
        }
      }

      if (myGen == ttsGenerationId.get() && totalFramesWritten > 0L) {
        val tr = track
        if (tr != null) {
          val maxWaitMs = ((totalFramesWritten * 1000L) / sampleRate.coerceAtLeast(8_000)) + 2_500L
          val startWait = System.currentTimeMillis()
          while (myGen == ttsGenerationId.get()) {
            val head = tr.playbackHeadPosition.toLong() and 0xFFFFFFFFL
            if (head >= totalFramesWritten) break
            if (System.currentTimeMillis() - startWait >= maxWaitMs) break
            try {
              Thread.sleep(25L)
            } catch (_: InterruptedException) {
              break
            }
          }
          try {
            tr.stop()
          } catch (_: Throwable) {}
        }
      }
    } finally {
      if (activeAudioTrack === track) {
        activeAudioTrack = null
      }
      try {
        track?.release()
      } catch (_: Throwable) {}
      if (myGen == ttsGenerationId.get()) {
        emitTtsState("idle")
      }
    }
  }

  fun synthesizeToWav(
    rawText: String,
    engine: String,
    voice: String,
    speed: Float,
    lang: String,
    outPath: String,
  ): Int {
    val clean = if (engine != "supertonic-3") {
      OnDeviceSpeechCatalog.normalizeTextForPocketFr(rawText)
    } else {
      rawText.trim()
    }
    require(clean.isNotEmpty()) { "Texte vide" }

    synchronized(ttsLock) {
      val usePocket = engine != "supertonic-3"
      val tts = if (usePocket) ensurePocketLoaded() else ensureSupertonicLoaded()
      val clampedSpeed = speed.coerceIn(0.6f, 1.8f)
      val genConfig = if (usePocket) {
        val wave = resolvePocketVoice(voice)
        GenerationConfig(
          speed = clampedSpeed,
          referenceAudio = wave.samples,
          referenceSampleRate = wave.sampleRate,
          numSteps = 5,
          extra = mapOf("temperature" to "0.3", "chunk_size" to "15"),
        )
      } else {
        GenerationConfig(
          sid = OnDeviceSpeechCatalog.SUPERTONIC_VOICES[voice.uppercase()] ?: 0,
          speed = clampedSpeed,
          numSteps = 6,
          extra = mapOf("lang" to lang.ifBlank { "fr" }),
        )
      }
      val audio = tts.generateWithConfig(text = clean, config = genConfig)
      audio.save(outPath)
      return audio.samples.size
    }
  }

  private fun stopAudioTrackOnly() {
    val track = activeAudioTrack
    activeAudioTrack = null
    if (track != null) {
      try {
        track.pause()
        track.flush()
        track.stop()
      } catch (_: Throwable) {}
      try {
        track.release()
      } catch (_: Throwable) {}
    }
  }

  private fun createStreamingTrack(sampleRate: Int): AudioTrack {
    val minBuf = AudioTrack.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    val bufferSize = maxOf(minBuf * 2, sampleRate / 2)
    return AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setBufferSizeInBytes(bufferSize)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
  }

  private fun writeFloatSamplesChunked(
    track: AudioTrack?,
    samples: FloatArray,
    myGen: Long,
  ): Int {
    if (track == null || samples.isEmpty()) return 0
    val pcm16 = ShortArray(samples.size)
    for (i in samples.indices) {
      val clamped = samples[i].coerceIn(-1.0f, 1.0f)
      pcm16[i] = (clamped * 32767.0f).roundToInt().coerceIn(-32768, 32767).toShort()
    }
    var written = 0
    val step = 4096
    while (written < pcm16.size && myGen == ttsGenerationId.get() && activeAudioTrack === track) {
      val len = minOf(step, pcm16.size - written)
      val n = track.write(pcm16, written, len, AudioTrack.WRITE_BLOCKING)
      if (n <= 0) break
      written += n
    }
    return written
  }

  private fun writePcm16ToTrack(track: AudioTrack?, pcm16: ShortArray): Int {
    if (track == null || pcm16.isEmpty()) return 0
    var written = 0
    while (written < pcm16.size && activeAudioTrack === track) {
      val n = track.write(pcm16, written, pcm16.size - written, AudioTrack.WRITE_BLOCKING)
      if (n <= 0) break
      written += n
    }
    return written
  }
}
