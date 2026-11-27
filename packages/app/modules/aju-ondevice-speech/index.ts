import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";

export type OnDeviceModelId = "asr-parakeet-v3" | "tts-pocket-fr" | "tts-supertonic-3";

export type OnDeviceTtsEngine = "pocket-fr" | "supertonic-3";

export type PocketVoiceId = "iris" | "julien" | "vald" | "estelle" | "fabien";

export type SupertonicVoiceId = "F1" | "F2" | "F3" | "F4" | "F5" | "M1" | "M2" | "M3" | "M4" | "M5";

export interface OnDeviceCapabilities {
  supported: boolean;
  abis: string[];
  totalRamMb: number;
  builtinVoices: string[];
}

export interface OnDeviceModelStatus {
  id: OnDeviceModelId;
  kind: "asr" | "tts";
  label: string;
  status: "ready" | "downloading" | "not_installed";
  ready: boolean;
  expectedSizeBytes: number;
  installedBytes: number;
  modelDir: string;
}

export interface DownloadProgressEvent {
  modelId: OnDeviceModelId;
  phase: "downloading" | "extracting" | "ready" | "cancelled" | "error";
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  message: string;
}

export interface SpeakOptions {
  engine?: OnDeviceTtsEngine;
  voice?: string;
  speed?: number;
  lang?: string;
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- expo EventsMap requires an implicit index signature from a type alias
type AjuOnDeviceSpeechEvents = {
  onDownloadProgress: (event: DownloadProgressEvent) => void;
  onAsrPartial: (event: { text: string }) => void;
  onTtsState: (event: { state: "idle" | "speaking" }) => void;
};

declare class AjuOnDeviceSpeechNativeModule extends NativeModule<AjuOnDeviceSpeechEvents> {
  getCapabilities(): OnDeviceCapabilities;
  getModelStatuses(): Record<OnDeviceModelId, OnDeviceModelStatus>;
  downloadModel(modelId: OnDeviceModelId): Promise<boolean>;
  cancelDownload(modelId: OnDeviceModelId): void;
  deleteModel(modelId: OnDeviceModelId): Promise<boolean>;
  preloadModel(modelId: OnDeviceModelId): Promise<boolean>;
  startAsr(): Promise<boolean>;
  feedAsrPcm(base64Pcm: string): void;
  finishAsr(): Promise<string>;
  cancelAsr(): void;
  speak(text: string, options: SpeakOptions): Promise<boolean>;
  stopSpeaking(): void;
  synthesizeToWav(text: string, options: SpeakOptions, outPath: string): Promise<number>;
}

const nativeModule =
  requireOptionalNativeModule<AjuOnDeviceSpeechNativeModule>("AjuOnDeviceSpeech");

export function getOnDeviceSpeechModule(): AjuOnDeviceSpeechNativeModule | null {
  return nativeModule ?? null;
}
